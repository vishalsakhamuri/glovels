/*
 * Round 177 — items 1, 8, 13, 15, 16, 17, 20 and 21 of the 28 Oct full test
 * (the matcher / finder / forms / services set).
 *
 *   8   Staff matcher: a HARD miss on a stated requirement (IELTS below the
 *       minimum with no accepted MOI letter, ECTS / degree length below, GRE
 *       below) is a NEAR row, below every fit, with the reason first — never
 *       a "fit" with a soft note. Not-stated stays unknown (soft). pick()
 *       fills from the fits first, then the near rows.
 *   16  fitErrors(): a CGPA below the pass mark is 422; a destination that is
 *       not a country we know is 422; the panel shows the reason under the box.
 *   15  Find University: the rows they clear, then a divider "Ranked lower —
 *       short of something they ask", then the rows with a hard miss. No
 *       numbers.
 *   1   The WhatsApp corner is lifted above the compare bar (618 and 375 px).
 *   13  Forgot password refuses a malformed address (browser and 422).
 *   17  One message limit — 2,000 — on /send.php, /api/enquiries, /api/assist
 *       and the lead store; 422 above it; a live counter on contact-us.
 *   20  Services → Language: the German course is "from ₹15,000", Book books
 *       the chosen level's price; "Insurer's rates" is priced on request and
 *       Book asks for a quote — never a ₹0 order. Admin → Home page: no ₹0.
 *   21  My Programs → Browse → "Ones I qualify for" applies the profile (CGPA
 *       bar via the finder's rule and the stated requirements); no count.
 *
 * Port 8129 by default (BASE overrides). Loads the German sheets itself when
 * the catalogue is small, as round175rulestest does.
 */
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8129';
const SCR = '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : '')); } };
const note = s => console.log('    · ' + s);
const J = x => JSON.stringify(x);
function done() { console.log('round177mattest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.177.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
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
  const M = require(path.join(__dirname, '..', 'server', 'matches.js'));
  const F = require(path.join(__dirname, '..', 'server', 'find.js'));
  const R = require(path.join(__dirname, '..', 'server', 'reqs.js'));
  const row = (id, extra) => Object.assign({ id, program: 'Data Science', university: 'Uni ' + id, city: 'X', country: 'DE', level: 'master',
    field: 'Data Science, AI & Machine Learning', isPublic: true, totalInr: 0, minCgpa: 7, intakes: [{ season: 'winter', deadline: '2027-07-15' }], reqs: {} }, extra || {});
  const cat = [
    row('clear'),
    row('ask', { reqs: { ieltsMin: 6.5 } }),                       /* stated, not answered → a question */
    row('ielts7', { reqs: { ieltsMin: 7, moiAccepted: false } }),  /* stated, answered, short → hard */
    row('ects', { reqs: { ectsMin: 210 } }),
    row('gre', { reqs: { greMin: 320 } }),
  ];
  const countries = { DE: { minCgpaPublic: 7, minCgpaPrivate: 6 } };
  const prof = { g_country: 'Germany', g_level: "Master's", g_field: 'Data Science', d_course: 'B.Tech CSE', d_cgpa: '7.8', d_max: '10' };
  /* With no English / ECTS / GRE answered: everything is a fit or a question. */
  let s = M.screen(cat, prof, countries, { limit: 50 });
  ok('unit: a requirement the student has not answered is a question, not a miss (' + s.counts.fits + ' fits, ' + s.counts.near + ' near)', s.counts.fits === 5 && s.counts.near === 0, J(s.counts));
  ok('  · the IELTS 6.5 row asks for the English score', (s.fits.find(x => x.id === 'ask') || {}).ask.includes('English score'));
  /* Answered and short: NEAR, below every fit, reason first. */
  s = M.screen(cat, Object.assign({}, prof, { e_test: 'IELTS', e_score: '5', d_moi: 'no', d_ects: '180', a_test: 'GRE', a_score: '300' }), countries, { limit: 50 });
  ok('unit: IELTS 5 / 180 ECTS / GRE 300 — the four short rows (IELTS 6.5 and 7, ECTS, GRE) are NEAR, not fits (' + s.counts.fits + ' fits, ' + s.counts.near + ' near)', s.counts.fits === 1 && s.counts.near === 4 && s.fits[0].id === 'clear', J(s.counts));
  ok('  · no fit carries a hard miss', s.fits.every(x => !(x.hard || []).length), J(s.fits.map(x => x.id)));
  const n7 = s.near.find(x => x.id === 'ielts7') || {};
  ok('  · the IELTS 7 row says the reason first: ' + J((n7.why || [])[0]), /^English test: asks IELTS 7/.test((n7.why || [])[0] || '') && (n7.hard || []).length === 1, J(n7.why));
  ok('  · the ECTS row: ' + J(((s.near.find(x => x.id === 'ects') || {}).why || [])[0]), /Bachelor ECTS: asks 210, they have 180/.test(((s.near.find(x => x.id === 'ects') || {}).why || [])[0] || ''));
  ok('  · the GRE row: ' + J(((s.near.find(x => x.id === 'gre') || {}).why || [])[0]), /GRE: asks 320, they have 300/.test(((s.near.find(x => x.id === 'gre') || {}).why || [])[0] || ''));
  /* IELTS 4 and 5 differ from 6.5; MOI "No" never clears. */
  const at = sc => M.screen(cat, Object.assign({}, prof, { e_test: 'IELTS', e_score: String(sc), d_moi: 'no' }), countries, { limit: 50 }).counts;
  ok('unit: IELTS 4 and 5 fit fewer rows than 6.5 does (' + at(4).fits + ' / ' + at(5).fits + ' / ' + at(6.5).fits + ')', at(4).fits === at(5).fits && at(5).fits < at(6.5).fits && at(6.5).fits === 4, J([at(4), at(5), at(6.5)]));
  /* pick(): fits first, then near — the package is filled from the fits. */
  const picked = M.pick(cat, Object.assign({}, prof, { e_test: 'IELTS', e_score: '5', d_moi: 'no', d_ects: '180', a_test: 'GRE', a_score: '300' }), 5, 'public', [], countries);
  const order = picked.map(p => p.id);
  ok('unit: pick() fills from the fits first, then the near rows: ' + order.join(' → '), order.length === 5 && order[0] === 'clear' && order.slice(1).every(id => /ask|ielts7|ects|gre/.test(id)), J(order));
  /* The same with a question row among the fits: a question ranks above a hard miss, below a clear row. */
  const picked2 = M.pick(cat, Object.assign({}, prof, { d_ects: '180', a_test: 'GRE', a_score: '300' }), 5, 'public', [], countries).map(p => p.id);
  ok('  · a row with an open question is still a fit and comes before every hard miss: ' + picked2.join(' → '), picked2.slice(0, 3).sort().join() === 'ask,clear,ielts7' && picked2[0] === 'clear' && picked2.slice(3).sort().join() === 'ects,gre', J(picked2));
  /* The letter still clears (patch 175 rule kept). */
  const v = R.check({ ieltsMin: 7, moiAccepted: true }, { ielts: 5, moi: true });
  ok('unit: an MOI letter where it is accepted still clears (round 175 rule kept)', v.fails.length === 0 && v.notes.includes('clears via MOI letter'), J(v));
  /* find.js: the divider, once, before the first short row; none without a profile. */
  const frows = cat.map(p => Object.assign({}, p, { uKey: p.id }));
  const out = F.run(frows, { country: 'DE', level: 'master', cgpa: '7.8', english: 'ielts:5', ects: '180' }, R, { countries });
  const html = F.listHtml(out.rows, { countries: {}, said: out.said });
  const at1 = html.indexOf('class="fdivide"');
  ok('unit: find.js draws ONE divider before the first short row', (html.match(/class="fdivide"/g) || []).length === 1 && at1 > 0, html.length);
  ok('  · every row before it clears, every row after it is short', !html.slice(0, at1).includes('Lower priority') && (html.slice(at1).match(/<article/g) || []).length === (html.slice(at1).match(/Lower priority/g) || []).length && (html.slice(at1).match(/<article/g) || []).length === 3, (html.slice(at1).match(/<article/g) || []).length);
  ok('  · the divider carries no number', !/\d/.test((/<div class="fdivide"[^>]*>.*?<\/div>/.exec(html) || [''])[0]));
  const out0 = F.run(frows, { country: 'DE', level: 'master' }, R, { countries });
  ok('  · with nothing said about themselves: no divider', !F.listHtml(out0.rows, { countries: {}, said: out0.said }).includes('fdivide'));
})();

(async () => {
  let up = false;
  try { up = (await fetch(BASE + '/api/health')).ok; } catch (e) { up = false; }
  if (!up) { console.log('  (no server on ' + BASE + ' — server checks skipped)'); return done(); }
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.status === 200, r.status);

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

  /* ============================================ item 8: the staff matcher */
  const B = { g_country: 'Germany', g_level: "Master's", g_field: 'Data Science', d_course: 'B.Tech CSE', d_max: '10', limit: 2000 };
  const fit = f => req('a', 'POST', '/api/staff/fit', { profile: {}, filters: Object.assign({}, B, f) });
  const good = await fit({ d_cgpa: '7.5', e_test: 'IELTS', e_score: '6.5' });
  const five = await fit({ d_cgpa: '7.5', e_test: 'IELTS', e_score: '5', d_moi: 'no' });
  const four = await fit({ d_cgpa: '7.5', e_test: 'IELTS', e_score: '4', d_moi: 'no' });
  const c = b => b.body.counts || {};
  ok('IELTS 6.5: ' + c(good).fits + ' fits · ' + c(good).near + ' near; IELTS 5, MOI no: ' + c(five).fits + ' fits · ' + c(five).near + ' near', good.ok && five.ok && c(five).fits < c(good).fits && c(five).near > c(good).near, J([c(good), c(five)]));
  ok('  · IELTS 4 fits no more than IELTS 5, and far fewer than 6.5', four.ok && c(four).fits <= c(five).fits && c(four).fits < c(good).fits, J(c(four)));
  ok('  · the set is the same size either way (country + level + field + CGPA decide it)', c(four).looked === c(good).looked && c(four).fits + c(four).near <= c(four).looked, J([c(four).looked, c(good).looked]));
  const hardFits = b => (b.body.fits || []).filter(x => (x.hard || []).length).length;
  ok('  · no "fit" carries a hard miss (6.5: ' + hardFits(good) + ', 5: ' + hardFits(five) + ')', hardFits(good) === 0 && hardFits(five) === 0);
  const ielts7 = (five.body.near || []).filter(x => (x.why || []).some(s => /^English test: asks IELTS 7(?! or).*they have IELTS 5/.test(s)));
  ok('  · rows asking IELTS 7 (and refusing MOI) sit in NEAR with the reason first (' + ielts7.length + ')', ielts7.length > 0 && ielts7.every(x => (x.hard || []).length && x.why[0] === x.hard[0]), J((ielts7[0] || {}).why));
  ok('  · and a near row is never above a fit: every fit ranks before it (the lists are separate)', (five.body.fits || []).every(x => !(x.hard || []).length) && (five.body.near || []).every(x => (x.hard || []).length || (x.why || []).length === 1));
  const ects = await fit({ d_cgpa: '7.5', e_test: 'IELTS', e_score: '6.5', d_ects: '180' });
  const ectsNear = (ects.body.near || []).filter(x => (x.why || []).some(s => /Bachelor ECTS: asks (210|240), they have 180/.test(s)));
  ok('180 ECTS against a stated 210–240: NEAR, not fit (' + ectsNear.length + ' rows, ' + c(ects).fits + ' fits < ' + c(good).fits + ')', ects.ok && ectsNear.length > 0 && c(ects).fits < c(good).fits, J(c(ects)));
  const unknown = (good.body.fits || []).filter(x => (x.ask || []).includes('bachelor ECTS') || (x.ask || []).includes('bachelor’s length')).length;
  ok('  · with the ECTS not said, those rows are fits with a question (' + unknown + ')', unknown > 0);
  /* The student's path: plan() on the same profile fills from the fits. */
  {
    const M = require(path.join(__dirname, '..', 'server', 'matches.js'));
    const auto = (five.body.auto || []).find(a => a.kind === 'public') || { picks: [] };
    const fitIds = new Set((five.body.fits || []).map(x => String(x.id)));
    const inFits = auto.picks.map(p => fitIds.has(String(p.id)));
    const fromFits = inFits.filter(Boolean).length;
    /* One pick per university: the fits can fill at most as many picks as
       they have universities; every one of those comes BEFORE any near pick. */
    /* pick() works inside the field asked for (relevance 3; a related field
       is relaxed into last, RELAX order), so the fits it can draw on are the
       exact-field public ones. */
    const fitUnis = new Set(); (five.body.fits || []).filter(x => x.isPublic && x.relevance === 3).forEach(x => M.uniKeys(x).forEach(k => fitUnis.add(k)));
    const prefix = inFits.every((v, i) => v || inFits.slice(i).every(x => !x));
    ok('  · what a package would deliver comes from the fits first (' + fromFits + ' of ' + auto.picks.length + '; the exact-field fits hold ' + fitUnis.size + ' public universities), near rows only after them', auto.picks.length > 0 && prefix && fromFits >= Math.min(auto.picks.length, fitUnis.size), J([inFits, auto.picks.map(p => p.university)]));
  }

  /* ============================================ item 16: impossible answers */
  const badPass = await fit({ d_cgpa: '7.8', d_pass: '9' });
  ok('pass mark 9 with CGPA 7.8 is refused (422) and names the pass box', badPass.status === 422 && (badPass.body.fields || []).some(f => f.field === 'd_pass' && /below the pass mark/.test(f.why)), badPass.status + ' ' + badPass.text.slice(0, 160));
  const okPass = await fit({ d_cgpa: '7.8', d_pass: '5' });
  ok('  · pass mark 5 with CGPA 7.8 runs', okPass.ok && c(okPass).looked > 0, okPass.status);
  const atl = await fit({ d_cgpa: '7.8', g_country: 'Atlantis' });
  ok('destination "Atlantis" is refused (422) and names the box', atl.status === 422 && (atl.body.fields || []).some(f => f.field === 'g_country' && /Atlantis/.test(f.why)), atl.status + ' ' + atl.text.slice(0, 160));
  for (const okC of ['Germany', 'DE', 'Germany, Poland', 'United Kingdom', '']) {
    const b = await fit({ d_cgpa: '7.8', g_country: okC });
    ok('  · "' + okC + '" is accepted', b.ok, b.status + ' ' + b.text.slice(0, 120));
  }

  /* ============================================ item 13: forgot password */
  r = await req('f', 'POST', '/api/auth/forgot', { email: 'not-an-email' });
  ok('/api/auth/forgot refuses "not-an-email" with 422', r.status === 422 && /email address/.test(r.body.error || ''), r.status + ' ' + r.text.slice(0, 120));
  r = await req('f', 'POST', '/api/auth/forgot', { email: 'nobody-' + Date.now() + '@example.com' });
  ok('  · a well-formed unknown address still gets the one generic answer', r.status === 200 && /If that email has an account/.test(r.body.message || ''), r.status + ' ' + r.text.slice(0, 120));
  const login = (await req('g', 'GET', '/login.html')).text;
  ok('  · login.html checks the address before calling the server', /not look like an email address/.test(login) && /\[\^@ \]\+@\[\^@ \]\+\[\.\]\[\^@ \]\+/.test(login));

  /* ============================================ item 17: the message limit */
  /* A fresh number each run: the same number again is filed on the open lead. */
  const stamp = String(Date.now()).slice(-6);
  const who = n => ({ name: 'Round One Seven Seven', phone: '97' + n + stamp + '0', email: 'r177-' + n + '-' + Date.now() + '@example.com', consent: 'yes', destination: 'Germany' });
  const long = 'x'.repeat(2001), exact = 'y'.repeat(2000);
  r = await req('c1', 'POST', '/send.php', Object.assign(who(1), { message: long }));
  ok('/send.php: 2,001 characters → 422 "Please keep the message under 2,000 characters"', r.status === 422 && /under 2,000 characters/.test(r.body.error || ''), r.status + ' ' + r.text.slice(0, 120));
  r = await req('c2', 'POST', '/api/enquiries', Object.assign(who(2), { message: long }));
  ok('/api/enquiries: the same', r.status === 422 && /under 2,000 characters/.test(r.body.error || ''), r.status);
  r = await req('c3', 'POST', '/api/assist', Object.assign(who(3), { note: long, filters: { country: 'DE' } }));
  ok('/api/assist: the same', r.status === 422 && /under 2,000 characters/.test(r.body.error || ''), r.status);
  const w4 = who(4);
  r = await req('c4', 'POST', '/send.php', Object.assign({}, w4, { message: exact }));
  ok('exactly 2,000 characters is taken', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
  {
    const leads = (await req('a', 'GET', '/api/staff/leads')).body.leads || [];
    const mine = leads.find(l => l.email === w4.email) || {};
    ok('  · and the lead holds all 2,000 — nothing cut at 1,800', (mine.note || '').includes(exact), (mine.note || '').length);
    /* The same person again: the note on the open lead keeps all 2,000 too. */
    r = await req('c4', 'POST', '/send.php', Object.assign({}, w4, { message: exact }));
    const detail = (await req('a', 'GET', '/api/staff/lead/' + mine.id)).body;
    const again = (detail.notes || []).find(n => /Enquired again/.test(n.body || ''));
    ok('  · the repeat enquiry\'s note on the lead holds all 2,000 (was cut at 1,800)', r.status === 200 && again && (again.body || '').includes(exact), again ? (again.body || '').length : 'no repeat note');
  }
  const contact = (await req('g', 'GET', '/contact-us.html')).text;
  ok('contact-us.html has the counter under the box and the 2,000 maxlength', /id="ctMsgCount"/.test(contact) && /id="ctMsg"[^>]*maxlength="2000"/.test(contact));

  /* ============================================ item 20: the services */
  const content = (await req('g', 'GET', '/api/content')).body;
  const svc = ((content.services || {}).items || []);
  const german = svc.find(x => x.id === 'german') || {};
  const insure = svc.find(x => x.id === 'insure') || {};
  ok('the German course carries its levels (A1 ₹15,000 … B2 ₹35,000)', (german.levels || []).length === 4 && german.levels[0].priceInr === 15000, J(german.levels));
  /* The page's scripts are hoisted into /js/<page>.<hash>.js — read those too. */
  const withJs = async (who, p) => {
    const html = (await req(who, 'GET', p)).text;
    const js = await Promise.all((html.match(/src="(\/js\/[^"]+)"/g) || []).map(async m => (await req(who, 'GET', /src="([^"]+)"/.exec(m)[1])).text));
    return html + '\n' + js.join('\n');
  };
  const adminHome = await withJs('a', '/home.html');
  ok('Admin → Home page never prints ₹0 for a service (levels "from", else "Price on request")', /Price on request'/.test(adminHome) && /'<b>from ' \+ inr\(/.test(adminHome), adminHome.length);

  /* A student for the browser checks: profile CGPA 7.0, IELTS 5.5, Germany. */
  const stu = { name: 'Round Seventy Seven', email: 'r177-student-' + Date.now() + '@example.com', phone: '9811177177', password: 'glovels-r177-pass', terms: 'yes' };
  r = await req('s', 'POST', '/api/auth/signup', stu);
  ok('a student signs up', r.status === 200 || r.status === 201, r.status + ' ' + r.text.slice(0, 120));
  r = await req('s', 'PUT', '/api/profile', { profile: { fullName: stu.name, d_cgpa: '7.0', d_max: '10', d_course: 'B.Tech CSE', d_dur: '3 years',
    g_level: "Master's", g_field: 'Computer Science', g_country: 'Germany', e_test: 'IELTS', e_score: '5.5', b_total: 'Above ₹40 Lakhs' } });
  ok('  · with a profile (CGPA 7.0, IELTS 5.5, 3-year bachelor\'s)', r.ok, r.status + ' ' + r.text.slice(0, 160));
  const svcPage = await withJs('s', '/services.html');
  ok('services.html prices a service with levels "from" its cheapest, and a priced-on-request one asks for a quote', /svcLevelFrom/.test(svcPage) && /Priced on request — Book to get a quote/.test(svcPage) && /Quote request: I would like to book/.test(svcPage), svcPage.length);

  let browser = null;
  try { browser = await require('playwright').chromium.launch(); } catch (e) { note('playwright not available: ' + e.message); }
  if (browser) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e)));

    /* item 16 on the screen: the reason under the pass box. */
    await page.goto(BASE + '/catalogue.html', { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-t="fit"]');
    await page.waitForSelector('#gfPass', { timeout: 10000 });
    await page.selectOption('#gfLevel', "Master's");
    await page.fill('#gfWords', 'Data Science');
    await page.fill('#gfCgpa', '7.8');
    await page.fill('#gfPass', '9');
    await page.click('#gfGo');
    await page.waitForSelector('#gfPassErr', { timeout: 10000 }).catch(() => {});
    const passErr = await page.$eval('#gfPassErr', e => e.textContent).catch(() => '');
    ok('matcher screen: pass mark 9 with CGPA 7.8 — the reason sits under the pass box', /below the pass mark/.test(passErr) && (await page.$eval('#gfPass', e => e.getAttribute('aria-invalid')).catch(() => '')) === 'true', passErr);
    /* item 8 on the screen: the near heading and the reason-first row. */
    await page.fill('#gfPass', '');
    await page.selectOption('#gfCountry', 'Germany').catch(() => {});
    await page.selectOption('#gfEng', 'IELTS');
    await page.fill('#gfEngS', '5');
    await page.selectOption('#gfMoi', 'no');
    await page.click('#gfGo');
    await page.waitForFunction(() => /Near — short of something they ask \(\d+\)/.test((document.querySelector('#gfOut') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => {});
    const outText = await page.$eval('#gfOut', e => e.textContent).catch(() => '');
    ok('  · the staff screen heads the second list "Near — short of something they ask (N)" and counts "N fit · N near"', /Near — short of something they ask \(\d+\)/.test(outText) && /\d+ fit\b/.test(outText) && /\d+ near/.test(outText), outText.slice(0, 200));
    const nearFirst = await page.$$eval('#gfOut h4 + ul li', lis => lis.map(li => li.textContent)).catch(() => []);
    const nearRows = await page.evaluate(() => { const h = [...document.querySelectorAll('#gfOut h4')].find(x => /^Near/.test(x.textContent)); const ul = h && h.nextElementSibling; return ul && ul.tagName === 'UL' ? [...ul.querySelectorAll('li')].slice(0, 5).map(li => li.textContent) : []; });
    ok('  · a near row says "Near — short of something they ask: English test: asks IELTS …" before its details', nearRows.some(t => /Near — short of something they ask: English test: asks IELTS/.test(t)), J(nearRows.slice(0, 2)));
    void nearFirst;

    /* item 20: Admin → Home page services table. */
    await page.goto(BASE + '/home.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tab[data-t="svc"]', { timeout: 15000 });
    await page.click('.tab[data-t="svc"]');
    await page.waitForTimeout(2500);
    const homeText = await page.evaluate(() => document.body.innerText);
    ok('Admin → Home page lists the German course "from ₹15,000", and no ₹0 anywhere', /from ₹15,000/.test(homeText) && !/₹0\b/.test(homeText), (homeText.match(/₹0\b[^\n]{0,40}/g) || []).slice(0, 3).join(' | '));

    /* item 21 + 20 as the student. */
    const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await sctx.request.post(BASE + '/api/auth/login', { data: { email: stu.email, password: stu.password } });
    const sp = await sctx.newPage();
    sp.on('pageerror', e => errs.push('student: ' + String(e)));
    await sp.goto(BASE + '/universities.html', { waitUntil: 'domcontentloaded' });
    await sp.waitForTimeout(3000);
    await sp.click('.tab[data-pane="browse"]');
    await sp.waitForTimeout(500);
    await sp.selectOption('#fCountry', 'DE').catch(() => {});
    await sp.selectOption('#fReach', 'all');
    await sp.waitForTimeout(600);
    const countOf = async () => sp.evaluate(() => { const grid = document.querySelector('#allGrid'); return grid ? grid.querySelectorAll('article, .sl').length : 0; });
    const lineOf = async () => sp.$eval('#cCount', e => e.textContent).catch(() => '');
    /* The cards shown are capped (show more), so the line is read as well as
       the "Short of what it asks" marks on the cards. */
    await sp.evaluate(() => { for (let i = 0; i < 200; i++) { const b = document.querySelector('#moreBtn'); if (!b || b.style.display === 'none') break; b.click(); } });
    await sp.waitForTimeout(400);
    const allN = await countOf(), allLine = await lineOf();
    const shortMarks = await sp.evaluate(() => [...document.querySelectorAll('#allGrid .sl-meta')].filter(e => /Short of what it asks|above yours/.test(e.textContent)).length);
    await sp.selectOption('#fReach', 'mine');
    await sp.waitForTimeout(600);
    await sp.evaluate(() => { for (let i = 0; i < 200; i++) { const b = document.querySelector('#moreBtn'); if (!b || b.style.display === 'none') break; b.click(); } });
    await sp.waitForTimeout(400);
    const mineN = await countOf(), mineLine = await lineOf();
    const mineShort = await sp.evaluate(() => [...document.querySelectorAll('#allGrid .sl-meta')].filter(e => /Short of what it asks|above yours/.test(e.textContent)).length);
    ok('Browse → "Ones I qualify for" shows fewer than "Show every programme" (' + mineN + ' < ' + allN + '; ' + shortMarks + ' marked short)', allN > 0 && mineN < allN && shortMarks > 0, J([mineN, allN, shortMarks]));
    ok('  · and none of the ones it keeps is marked short', mineShort === 0, mineShort);
    ok('  · the line under the filters carries no count ("' + mineLine.trim().slice(0, 90) + '")', !/\d+ programme/.test(mineLine) && !/\d+ more/.test(mineLine) && !/showing \d/.test(mineLine) && /higher CGPA than 7/.test(mineLine), mineLine);
    ok('  · nor does "every programme" (' + allLine.trim().slice(0, 60) + ')', !/\d+ programme/.test(allLine) && !/showing \d/.test(allLine), allLine);
    ok('  · the Browse tab shows no number', (await sp.$eval('#nAll', e => e.textContent.trim())) === '');

    /* item 20: Services → Language as the student. */
    await sp.goto(BASE + '/services.html', { waitUntil: 'domcontentloaded' });
    await sp.waitForSelector('[data-svccat="lang"]', { timeout: 15000 });
    await sp.click('[data-svccat="lang"]');
    await sp.waitForTimeout(300);
    const germanCard = await sp.$eval('[data-svc="german"]', e => e.textContent).catch(() => '');
    ok('Services → Language: the German course is "from ₹15,000", not ₹0', /from ₹15,000/.test(germanCard) && !/₹0\b/.test(germanCard), germanCard.slice(0, 200));
    await sp.click('[data-svc="german"] [data-svcbook]');
    await sp.waitForSelector('#svcCoLvl', { timeout: 10000 });
    const lvlOpts = await sp.$$eval('#svcCoLvl option', os => os.map(o => o.textContent));
    const confirm0 = await sp.$eval('#svcCoPay', e => e.textContent);
    await sp.selectOption('#svcCoLvl', 'B1');
    await sp.waitForTimeout(200);
    const confirmB1 = await sp.$eval('#svcCoPay', e => e.textContent);
    ok('  · Book opens the level choice (' + lvlOpts.join(', ') + ') and books that level\'s price (A1 ' + confirm0 + ' → B1 ' + confirmB1 + ')', lvlOpts.length === 4 && /15,000/.test(confirm0) && /20,000/.test(confirmB1), J([lvlOpts, confirm0, confirmB1]));
    await sp.click('[data-svcco-x]');
    await sp.click('[data-svccat="post"]');
    await sp.waitForTimeout(300);
    const insCard = await sp.$eval('[data-svc="insure"]', e => e.textContent).catch(() => '');
    ok('  · Travel & Health Insurance says "Priced on request — Book to get a quote"', /Priced on request — Book to get a quote/.test(insCard) && /Book — get a quote/.test(insCard), insCard.slice(0, 200));
    const ordersBefore = ((await req('s', 'GET', '/api/state')).body.orders || []).length;
    await sp.click('[data-svc="insure"] [data-svcbook]');
    await sp.waitForTimeout(1500);
    const st = (await req('s', 'GET', '/api/state')).body;
    const quoteMsg = (st.msgs || []).find(m => /Quote request: I would like to book Travel & Health Insurance/.test(m.t || m.body || ''));
    ok('  · Book on it sends a quote request to the counsellor and makes NO order', !!quoteMsg && (st.orders || []).length === ordersBefore && !(st.orders || []).some(o => (o.items || []).some(i => i.id === 'insure')), J([(st.orders || []).length, ordersBefore, (st.msgs || []).slice(-1).map(m => m.t || m.body)]));
    const insBtn = await sp.$eval('[data-svc="insure"] [data-svcbook]', e => e.textContent).catch(() => '');
    ok('  · and the button says so', /Quote requested/.test(insBtn), insBtn);

    /* item 13 on the screen. */
    const gctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const gp = await gctx.newPage();
    gp.on('pageerror', e => errs.push('login: ' + String(e)));
    await gp.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
    await gp.fill('#lEmail', 'not-an-email');
    await gp.evaluate(() => forgotPassword());
    await gp.waitForSelector('#forgotBox', { timeout: 5000 });
    const fb = await gp.$eval('#forgotBox', e => ({ text: e.textContent, color: getComputedStyle(e).color }));
    ok('login: "Forgot password?" with "not-an-email" says it is not an address (and not "on its way")', /not look like an email address/.test(fb.text) && !/on its way/.test(fb.text), fb.text);

    /* item 17 on the screen: the live counter. */
    await gp.goto(BASE + '/contact-us.html', { waitUntil: 'domcontentloaded' });
    await gp.waitForSelector('#ctMsgCount', { timeout: 5000 });
    const c0 = await gp.$eval('#ctMsgCount', e => e.textContent);
    await gp.fill('#ctMsg', 'Hello there');
    const c1 = await gp.$eval('#ctMsgCount', e => e.textContent);
    ok('contact-us: a live counter under the message box (' + c0 + ' → ' + c1 + ')', /^0 \/ 2,000/.test(c0) && /^11 \/ 2,000/.test(c1), J([c0, c1]));

    /* item 15 on the screen: the divider, drawn by the browser as well. */
    const fq = '/find-university?country=DE&level=master&field=' + encodeURIComponent('Computer Science & IT') + '&cgpa=7.5&english=ielts:5&ects=180';
    const raw = (await req('g', 'GET', fq)).text;
    const atDiv = raw.indexOf('<div class="fdivide"');
    ok('Find University (server render): one divider, every row before it clears, every row after it is short', (raw.match(/<div class="fdivide"/g) || []).length === 1 && !raw.slice(0, atDiv).includes('Lower priority') && (raw.slice(atDiv).match(/<article class="frow/g) || []).length > 0 && (raw.slice(atDiv).match(/<article class="frow/g) || []).length === (raw.slice(atDiv).match(/Lower priority/g) || []).length, J([(raw.match(/<div class="fdivide"/g) || []).length, atDiv]));
    ok('  · the divider carries no number', !/\d/.test((/<div class="fdivide"[^>]*>.*?<\/div>/.exec(raw) || [''])[0]));
    ok('  · with no profile said: no divider', !/<div class="fdivide"/.test((await req('g', 'GET', '/find-university?country=DE&level=master')).text));
    await gp.goto(BASE + fq, { waitUntil: 'domcontentloaded' });
    await gp.waitForTimeout(2500);
    const divs = await gp.evaluate(() => {
      const list = document.querySelector('#flist'); if (!list) return null;
      const kids = [...list.children];
      const i = kids.findIndex(k => k.classList.contains('fdivide'));
      return { n: kids.filter(k => k.classList.contains('fdivide')).length, i,
        beforeShort: kids.slice(0, i).filter(k => /Lower priority/.test(k.textContent)).length,
        after: kids.slice(i + 1).length, afterShort: kids.slice(i + 1).filter(k => /Lower priority/.test(k.textContent)).length };
    });
    ok('  · the browser draws the same split', divs && divs.n === 1 && divs.i > 0 && divs.beforeShort === 0 && divs.after > 0 && divs.after === divs.afterShort, J(divs));
    await gp.selectOption('#fsort', 'cost').catch(() => {});
    await gp.waitForTimeout(600);
    const divs2 = await gp.evaluate(() => { const list = document.querySelector('#flist'); const kids = [...list.children]; const i = kids.findIndex(k => k.classList.contains('fdivide')); return { n: kids.filter(k => k.classList.contains('fdivide')).length, beforeShort: kids.slice(0, i).filter(k => /Lower priority/.test(k.textContent)).length }; });
    ok('  · sorted by cost, the short rows still sit under the divider', divs2.n === 1 && divs2.beforeShort === 0, J(divs2));

    /* item 1: the compare bar is not under the WhatsApp button. */
    for (const w of [618, 375]) {
      const nctx = await browser.newContext({ viewport: { width: w, height: 760 } });
      const np = await nctx.newPage();
      np.on('pageerror', e => errs.push('find@' + w + ': ' + String(e)));
      await np.goto(BASE + '/find-university?country=DE&level=master', { waitUntil: 'domcontentloaded' });
      await np.waitForSelector('[data-cmp]', { timeout: 15000 });
      await np.waitForTimeout(1500);
      const btns = await np.$$('[data-cmp]');
      await btns[0].click(); await btns[1].click();
      await np.waitForTimeout(500);
      const hit = await np.evaluate(() => {
        const el = document.querySelector('#fcmpClear'), go = document.querySelector('#fcmpGo');
        const mid = e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); };
        const corner = document.querySelector('.gv-corner');
        const cr = corner ? corner.getBoundingClientRect() : null, br = document.querySelector('#fcmp').getBoundingClientRect();
        return { clear: mid(el) === el, go: mid(go) === go, hidden: document.querySelector('#fcmp').hidden,
          cornerAbove: cr ? cr.bottom <= br.top + 1 : 'no corner', lifted: document.body.classList.contains('fcmp-open') };
      });
      ok('at ' + w + 'px the centre of "Clear" is the Clear button, and "Compare side by side" is reachable', hit.clear && hit.go && !hit.hidden, J(hit));
      ok('  · the WhatsApp corner sits above the bar', hit.cornerAbove === true && hit.lifted, J(hit));
      await nctx.close();
    }

    ok('no script errors on any of the screens', !errs.length, errs.join(' | '));
    await browser.close();
  }

  done();
})().catch(e => { console.error(e); fail++; done(); });
