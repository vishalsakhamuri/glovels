/**
 * Round 176 (owner, go-live) — the hidden set cannot be counted.
 *
 * "Unis should filter, we need to maintain secrecy. Students should not know
 *  how many universities are in the filter at the back end — 30 or 40 — as
 *  we only show as per the package selected." And the standing rule:
 * "numbers not required".
 *
 * Until now /api/catalogue sent EVERY locked public row (1,605 on live) as a
 * placeholder, and the pages printed "1,846 programmes at 131 universities
 * match", "(158)" beside each option and "N universities" headings — so a
 * visitor could count the hidden set from the page or from the JSON.
 *
 * This suite runs the attack rather than reading the code:
 *   - signed out, /api/catalogue carries at most LOCKED_CAP (12) locked rows,
 *     no total / unlockedCount, and facet LISTS with no number in them
 *   - /api/find/locked answers five different filters with ≤ 12 rows each,
 *     a boolean `more`, and nothing that counts
 *   - the Find University page and the home page carry no "N programmes" /
 *     "N universities" in a summary, an option, a heading or the meta
 *     description, and at most 12 locked rows
 *   - a student whose package names 3 universities sees exactly those named
 *     plus ≤ 12 placeholders — never the whole set
 *   - a staff session still gets the whole catalogue, with counts
 *   - the same guarantees hold on the full German catalogue (the sheets)
 *
 * Port 8123 by default (BASE overrides). Loads the German sheets when they
 * are on disk and the catalogue is small.
 */
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8123';
const SCR = process.env.R165_SCRATCH || '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
const F = require(path.join(__dirname, '..', 'server', 'find.js'));
const CAP = F.LOCKED_CAP;

let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + String(e === undefined ? '' : e).slice(0, 300))); };
const note = t => console.log('    · ' + t);
const J = x => JSON.stringify(x);
const done = () => { console.log('\nround176secrecytest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); };

const jars = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.176.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] };
  if (jars[who]) h.cookie = jars[who];
  const once = () => fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const r = await once().catch(() => once());
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jars[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; const text = await r.text();
  try { j = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, ok: r.ok, body: j, text };
}
const isLocked = p => p && p.isPublic && !p.university;
/* The number-count attack on a page: digits before "programme(s)" or
   "universit(y|ies)" in the summary, the options, the headings and the
   meta description. The package cards ("Reveals 5 public universities")
   are the package's own promise and are not the hidden set, so the whole
   page is not the test — those regions are. */
const COUNT = /\d[\d,]* (programme|universit)/i;
function countsOn(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const hits = [];
  const take = (label, re) => { const m = body.match(re) || []; m.forEach(x => { if (COUNT.test(x)) hits.push(label + ': ' + x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)); }); };
  take('summary', /id="fsummary"[^>]*>[^<]*/g);
  take('option', /<option[^>]*>[^<]*/g);
  take('label', /<label class="fopt[^"]*">[\s\S]*?<\/label>/g);
  take('heading', /<h[1-4][^>]*>[\s\S]*?<\/h[1-4]>/g);
  take('description', /<meta name="description" content="[^"]*"/g);
  take('banner', /id="rBanner"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g);
  take('tab', /class="rtab[^"]*"[^>]*>[\s\S]*?<\/button>/g);
  take('fprof', /class="fprof[^"]*">[\s\S]*?<\/div>/g);
  take('more', /class="f?m?more-locked"[^>]*>[\s\S]*?<\/div>/g);
  return hits;
}
const lockedOn = html => (html.match(/class="frow locked"/g) || []).length;
const noNumbers = o => JSON.stringify(o).search(/\d/) < 0;

async function guarantees(label) {
  console.log('\n— ' + label);
  /* ------------------------------------------------------ /api/catalogue */
  const cat = (await req('guest', 'GET', '/api/catalogue')).body || {};
  const locked = (cat.programmes || []).filter(isLocked);
  ok('signed out, /api/catalogue carries at most ' + CAP + ' locked rows', locked.length > 0 && locked.length <= CAP, locked.length);
  ok('  · and no total, unlockedCount or any other number for the hidden set',
    cat.total === undefined && cat.unlockedCount === undefined && cat.count === undefined && typeof cat.more === 'boolean',
    J(Object.keys(cat)));
  ok('  · the facets are lists of values with no number in them',
    cat.facets && ['country', 'level', 'field', 'intake'].every(k => Array.isArray(cat.facets[k]) && cat.facets[k].length > 0)
    && noNumbers(cat.facets.country) && noNumbers(cat.facets.level) && noNumbers(cat.facets.field)
    && cat.facets.intake.every(t => /^(summer|winter)-\d{4}$/.test(t)),
    J(cat.facets));
  ok('  · the placeholders carry no name, no length, no real id',
    locked.every(p => !p.university && !p.program && p.nLen === undefined && p.uLen === undefined && /^xp[0-9a-f]+$/.test(String(p.id)) && /^xu[0-9a-f]+$/.test(String(p.uKey))));
  ok('  · and are spread over more than one (country, level, field) kind',
    new Set(locked.map(p => [p.country, p.level, p.field].join('|'))).size > 1,
    J([...new Set(locked.map(p => [p.country, p.level, p.field].join('|')))]));
  /* Two responses: the stand-in keys never match, so they cannot be joined
     to count across responses either. */
  const cat2 = (await req('guest', 'GET', '/api/catalogue')).body || {};
  const ids1 = new Set(locked.map(p => p.id)), locked2 = (cat2.programmes || []).filter(isLocked);
  ok('  · a second response has fresh stand-in ids (nothing to join on)', locked2.length > 0 && !locked2.some(p => ids1.has(p.id)));

  /* ----------------------------------------------------- /api/find/locked */
  const filters = ['', '?country=DE', '?country=DE&level=master', '?country=DE&level=master&cgpa=8', '?tags=' + encodeURIComponent('No German Required')];
  for (const q of filters) {
    const r = (await req('guest', 'GET', '/api/find/locked' + q)).body || {};
    ok('/api/find/locked' + (q || ' (no filter)') + ': ≤ ' + CAP + ' rows, `more` a boolean, no count',
      Array.isArray(r.locked) && r.locked.length <= CAP && typeof r.more === 'boolean'
      && Object.keys(r).every(k => k === 'locked' || k === 'more')
      && r.locked.every(p => isLocked(p) && p.nLen === undefined && /^xp/.test(String(p.id))),
      r.locked ? r.locked.length + ' rows, keys ' + J(Object.keys(r)) : J(r).slice(0, 120));
  }
  const de = (await req('guest', 'GET', '/api/find/locked?country=DE')).body || {};
  const pl = (await req('guest', 'GET', '/api/find/locked?country=PL')).body || {};
  ok('  · the filter is honoured (every DE row is DE; a country with no public rows gives none)',
    (de.locked || []).length > 0 && de.locked.every(p => p.country === 'DE') && (pl.locked || []).length === 0 && pl.more === false);
  const ggpa = (await req('guest', 'GET', '/api/find/locked?country=DE&ggpa=1.0')).body || {};
  ok('  · ggpa= narrows the way the home page does (no stated grade better than 1.0)',
    (ggpa.locked || []).every(p => p.germanGpa == null || Number(p.germanGpa) >= 1.0));

  /* --------------------------------------------------- the two pages */
  for (const p of ['/find-university', '/find-university?country=DE', '/find-university?country=DE&level=master&cgpa=7', '/find-university?view=uni']) {
    const html = (await req('guest', 'GET', p)).text;
    const hits = countsOn(html);
    ok(p + ': no "N programmes" / "N universities" in summary, options, headings or description', hits.length === 0, J(hits.slice(0, 4)));
    ok('  · at most ' + CAP + ' locked rows on the page', lockedOn(html) <= CAP, lockedOn(html));
    ok('  · no data-total, no facet <em> counts', !/data-total=/.test(html) && !/<em>[\d,]+<\/em>/.test(html));
  }
  {
    const home = (await req('guest', 'GET', '/')).text;
    const hits = countsOn(home);
    ok('the home page: no "N programmes" / "N universities" in its summary, options, headings, tabs or description', hits.length === 0, J(hits.slice(0, 4)));
    ok('  · the budget cards and the tabs carry no number', !/class="rail-n">\d/.test(home) && !/id="rtnP(ub|riv)">\d/.test(home));
    const js = home.match(/src="(\/js\/index\.[0-9a-f]+\.js)"/);
    const script = js ? (await req('guest', 'GET', js[1])).text : home;
    ok('  · its script carries no baked public row', !/"isPublic":\s*true/.test(script) && !/"id":\s*"gated-/.test(script));
  }

  /* ------------------------------------------------- staff keep everything */
  const staffCat = (await req('staff', 'GET', '/api/staff/catalogue?per=1&status=')).body || {};
  ok('a staff session still gets the whole catalogue with its count', Number(staffCat.total) > 0 && staffCat.stats, 'total ' + staffCat.total);
  const staffPub = (await req('staff', 'GET', '/api/catalogue')).body || {};
  ok('  · and /api/catalogue names every public row for staff (no placeholder)',
    (staffPub.programmes || []).some(p => p.isPublic) && !(staffPub.programmes || []).some(isLocked));
  const staffFilt = (await req('staff', 'GET', '/api/universities/filter?country=DE')).body || {};
  const guestFilt = (await req('guest', 'GET', '/api/universities/filter?country=DE')).body || {};
  ok('  · /api/universities/filter carries a total for staff and none for a visitor',
    typeof staffFilt.total === 'number' && guestFilt.total === undefined && typeof guestFilt.more === 'boolean'
    && (guestFilt.universities || []).every(u => u.programmes === undefined && u.matching === undefined));
  return { lockedSeen: locked.length, staffTotal: staffCat.total };
}

(async () => {
  let up = false;
  try { up = (await fetch(BASE + '/api/health')).ok; } catch (e) { up = false; }
  if (!up) { console.log('  (no server on ' + BASE + ')'); fail++; return done(); }
  const login = await req('staff', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('staff can sign in', login.ok, login.status);

  /* ---------------------------------------------- the seed catalogue */
  const seed = await guarantees('the seed catalogue (171 rows)');

  /* ---------------------------------- a student with a 3-university package */
  console.log('\n— a student whose package names 3 universities');
  const email = 'r176-' + Date.now() + '@glovels.com';
  const order = await req('stu', 'POST', '/api/orders', { packageId: 'pkg-three-public', name: 'Secrecy Test', email, phone: '9876543211', acceptedTerms: true });
  ok('an order for the 3-university package is placed (and signs the buyer in)', order.ok && order.body && order.body.publicUnis === 3, order.status + ' ' + J(order.body || {}).slice(0, 140));
  const mine = (await req('stu', 'GET', '/api/catalogue')).body || {};
  const named = (mine.programmes || []).filter(p => p.isPublic && p.university);
  const namedUnis = new Set(named.map(p => p.uKey));
  const placeholders = (mine.programmes || []).filter(isLocked);
  ok('they see exactly their 3 universities named', namedUnis.size === 3 && named.every(p => p.program && p.university), namedUnis.size + ' named');
  ok('  · plus at most ' + CAP + ' placeholders — never the whole set', placeholders.length > 0 && placeholders.length <= CAP, placeholders.length);
  ok('  · and no number about the hidden set', mine.unlockedCount === undefined && mine.total === undefined && typeof mine.more === 'boolean');
  const stuLocked = (await req('stu', 'GET', '/api/find/locked?country=DE')).body || {};
  ok('  · /api/find/locked gives them ≤ ' + CAP + ' rows too, none of them one of their named universities',
    Array.isArray(stuLocked.locked) && stuLocked.locked.length <= CAP && stuLocked.locked.every(p => isLocked(p)), (stuLocked.locked || []).length);
  const stuFind = (await req('stu', 'GET', '/find-university?country=DE')).text;
  ok('  · the Find University page draws them ≤ ' + CAP + ' locked rows and no count', lockedOn(stuFind) <= CAP && countsOn(stuFind).length === 0, lockedOn(stuFind) + ' ' + J(countsOn(stuFind).slice(0, 2)));

  /* ---------------------------------------------- the German catalogue */
  const total0 = Number(seed.staffTotal || 0);
  const sheets = [SCR + '/r165/live-DE-noid.xlsx', SCR + '/out/glovels-germany-v37-new-rows.xlsx'].filter(f => fs.existsSync(f));
  if (total0 < 1000 && sheets.length) {
    for (const f of sheets) {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
      const u = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jars.staff, 'x-forwarded-for': ips.staff }, body: fd });
      note('loaded ' + path.basename(f) + ': ' + u.status + ' ' + (await u.text()).slice(0, 120));
    }
    const big = (await req('staff', 'GET', '/api/staff/catalogue?per=1&status=')).body || {};
    ok('the German sheets are loaded (over 2,000 rows)', Number(big.total) > 2000, big.total);
    await guarantees('the German catalogue (' + big.total + ' rows)');
    /* The student's view on the big catalogue: still 3 named, still ≤ 12. */
    const mineBig = (await req('stu', 'GET', '/api/catalogue')).body || {};
    const nBig = new Set((mineBig.programmes || []).filter(p => p.isPublic && p.university).map(p => p.uKey)).size;
    const pBig = (mineBig.programmes || []).filter(isLocked).length;
    ok('the 3-university student on the German catalogue: 3 named, ≤ ' + CAP + ' placeholders', nBig === 3 && pBig > 0 && pBig <= CAP, nBig + ' named, ' + pBig + ' placeholders');
  } else if (!sheets.length) {
    note('German sheets not on disk (' + SCR + ') — the big-catalogue pass is skipped');
  }

  /* ------------------------------------------- in the browser, after the JS */
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { chromium = null; }
  if (chromium) {
    console.log('\n— in the browser');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    const asked = []; page.on('request', r => { if (/\/api\/find\/locked/.test(r.url())) asked.push(r.url().replace(BASE, '')); });
    await page.goto(BASE + '/find-university?country=DE', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const st = () => page.evaluate(() => ({
      locked: document.querySelectorAll('#flist .frow.locked').length, rows: document.querySelectorAll('#flist .frow').length,
      sum: document.querySelector('#fsummary').textContent, ems: document.querySelectorAll('#frail .fopt em').length,
      more: !!document.querySelector('#fmoreLocked'), unis: [...document.querySelectorAll('.funi')].map(h => h.textContent.trim()),
      prof: (document.querySelector('.fprof') || {}).textContent || '',
    }));
    let x = await st();
    ok('Find University, re-drawn by the browser: ≤ ' + CAP + ' locked rows, a summary with no number, no counts on the rail', x.locked <= CAP && x.rows > 0 && !/\d/.test(x.sum) && x.ems === 0, J(x));
    ok('  · "More public universities match — a package opens them" when the cap was hit', x.more === true, J(x.more));
    await page.evaluate(() => { const i = document.querySelector('input[name=level][value=master]'); i.closest('details').open = true; i.click(); });
    await page.waitForTimeout(1200);
    x = await st();
    ok('  · a filter change asks /api/find/locked for that filter and stays within the cap', asked.some(u => /country=DE&level=master/.test(u)) && x.locked <= CAP, J(asked) + ' ' + x.locked);
    await page.evaluate(() => { const i = document.querySelector('#fcgpa'); i.value = '6'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(1200);
    x = await st();
    ok('  · with a CGPA the turned-away line says "Some programmes", never a number', /Some programmes ask a higher CGPA|Checked against/.test(x.prof) && !/\d+ programmes? ask/.test(x.prof), x.prof.slice(0, 120));
    await page.click('[data-view="uni"]'); await page.waitForTimeout(600);
    x = await st();
    ok('  · by university: the named universities, and ONE block for the public ones', x.unis.filter(u => /Public universities — unlocked with a package/.test(u)).length <= 1 && !x.unis.some(u => COUNT.test(u)), J(x.unis.slice(0, 6)));
    ok('  · no page errors', errs.length === 0, errs.join(' | '));

    const hp = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const herrs = []; hp.on('pageerror', e => herrs.push(String(e)));
    const hasked = []; hp.on('request', r => { if (/\/api\/find\/locked/.test(r.url())) hasked.push(r.url().replace(BASE, '')); });
    await hp.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await hp.waitForTimeout(2500);
    await hp.selectOption('#fCountry', 'DE'); await hp.click('#fGo'); await hp.waitForTimeout(1500);
    const pubTab = await hp.$('.rtab[data-rt="priv"]'); if (pubTab) await pubTab.click(); await hp.waitForTimeout(600);
    const h = await hp.evaluate(() => ({
      rows: document.querySelectorAll('#rowsIn .mrow').length, locked: document.querySelectorAll('#rowsIn .mrow .lockword').length,
      more: !!document.querySelector('#rMoreLocked'), banner: document.querySelector('#rBanner').textContent.trim(),
      tabs: [...document.querySelectorAll('.rtab .rtn')].map(e => e.textContent.trim()), rail: [...document.querySelectorAll('.rail-n')].map(e => e.textContent.trim()),
    }));
    ok('the home finder, Germany, the Public tab: ≤ ' + CAP + ' locked rows and the "more" line', h.locked > 0 && h.locked <= CAP && h.more, J(h));
    ok('  · the banner, the tabs and the budget cards carry no count', !COUNT.test(h.banner) && h.tabs.every(t => t === '') && h.rail.every(t => t === ''), J(h));
    ok('  · it asked /api/find/locked for Germany', hasked.some(u => /country=DE/.test(u)), J(hasked));
    ok('  · no page errors', herrs.length === 0, herrs.join(' | '));
    await browser.close();
  } else note('no playwright — the browser checks are skipped');

  /* -------------------------------------------------------- the throttle */
  const burst = [];
  for (let i = 0; i < 6; i++) burst.push(req('burst', 'GET', '/api/find/locked?country=DE&level=master&field=x' + i));
  const codes = (await Promise.all(burst)).map(r => r.status);
  ok('a handful of filter changes in a row are answered (the throttle is light)', codes.every(c => c === 200), J(codes));
  done();
})().catch(e => { console.log('  ✗ crashed: ' + (e && e.stack || e)); fail++; done(); });
