/*
 * Round 169 — the public website items from the 10 Oct retest (owner's list,
 * items 1–6) and the 12 Oct launch-readiness report (WEB-02 … WEB-20, W17).
 *
 *   ./tests/srv.sh 8101
 *   BASE=http://localhost:8101 node tests/round169webtest.js
 *
 * Loads the live German sheet (scratchpad r165/live-DE-noid.xlsx, as round165
 * does) when the catalogue is still the 171-row seed, so the search, the CGPA
 * and the website checks run on a catalogue of the live size.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8101';
const SHOTS = '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
const ROOT = path.join(__dirname, '..');
const FIND = require(path.join(ROOT, 'server', 'find.js'));
const REQS = require(path.join(ROOT, 'server', 'reqs.js'));
const PLANS = require(path.join(ROOT, 'server', 'plans.js'));
const WRITING = require(path.join(ROOT, 'server', 'writing.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : '')); } };
const J = x => JSON.stringify(x);

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body, extraHeaders) {
  ips[who] = ips[who] || ('10.169.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': ips[who] }, extraHeaders || {});
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).filter(c => !/=$/.test(c)).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text, set };
}
const page = async p => (await fetch(BASE + p)).text();
const summary = h => ((/<h2 id="fsummary">([^<]*)/.exec(h) || [])[1] || '');
const nProg = h => Number((summary(h).match(/^([\d,]+)/) || ['', '0'])[1].replace(/,/g, ''));

(async () => {
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('the administrator signs in', r.status === 200, r.status);

  /* ---------------------------------------------------- the German catalogue */
  const cat0 = (await req('anon', 'GET', '/api/catalogue')).body.programmes || [];
  if (cat0.length < 1000) {
    const f = SHOTS + '/r165/live-DE-noid.xlsx';
    if (fs.existsSync(f)) {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
      const up = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jar.a, 'x-forwarded-for': ips.a }, body: fd });
      console.log('    · loaded the German sheet: ' + up.status + ' ' + (await up.text()).slice(0, 90));
    } else console.log('    · (no German sheet at ' + f + ' — running on the seed)');
  }
  const big = ((await req('anon', 'GET', '/api/catalogue')).body.programmes || []).length > 1000;

  /* ===================================================== 3, 5, 6: the header */
  console.log('\n— the header (items 3, 5, 6)');
  for (const p of ['/', '/study-in-germany', '/blog', '/find-university', '/university/rwth-aachen-university', '/success-stories', '/refer', '/contact-us']) {
    const h = await page(p);
    const nav = (/<nav class="menu"[\s\S]*?<\/nav>/.exec(h) || [''])[0];
    ok(p + ': Find University is the last item, after Contact, as a button',
      /Contact<\/a><a class="nav-find" href="\/find-university">Find University<\/a><\/nav>/.test(nav), nav.slice(-200));
    ok(p + ': About Us is not in the header', !/About Us/.test(nav));
    ok(p + ': the phone menu has it too, after Contact', /Contact<\/a><a class="nav-find" href="\/find-university">Find University<\/a>\s*<a href="[^"]*login[^"]*">Sign in/.test(h));
    ok(p + ': a skip-to-content link aimed at the main landmark', /<a class="skip-link" href="#main">Skip to content<\/a>/.test(h) && /<main id="main"/.test(h));
    ok(p + ': the office phone in the footer', /<footer class="site"[\s\S]*<b>Phone<\/b><a href="tel:\+\d+/.test(h));
  }
  ok('the About Us page itself is still there', (await fetch(BASE + '/about-us')).status === 200);
  ok('and the footer still links to it', /<footer class="site"[\s\S]*about-us[^>]*>About Us<\/a>/.test(await page('/')));

  /* ===================================================== WEB-09: the 404 page */
  console.log('\n— WEB-09: the 404 page');
  for (const p of ['/post/old-article-that-moved', '/university/x/y']) {
    const res = await fetch(BASE + p);
    const h = await res.text();
    const hrefs = [...h.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
    const rel = hrefs.filter(v => !/^(\/|#|https?:|mailto:|tel:)/.test(v));
    ok(p + ' answers 404 with every link absolute', res.status === 404 && hrefs.length > 20 && !rel.length, J(rel.slice(0, 5)));
    ok(p + ': its home link is /', hrefs.includes('/'));
  }

  /* =========================================== WEB-02 / WEB-12: CGPA and fit */
  console.log('\n— WEB-02 / WEB-12: the CGPA decides, no Fit %');
  const C = {};
  for (const cg of ['5', '6', '7.5', '9.5']) C[cg] = await page('/find-university?cgpa=' + cg);
  ok('a lower CGPA shows fewer programmes (5 < 6 < 7.5 ≤ 9.5)',
    nProg(C['5']) < nProg(C['6']) && nProg(C['6']) < nProg(C['7.5']) && nProg(C['7.5']) <= nProg(C['9.5']),
    ['5', '6', '7.5', '9.5'].map(k => summary(C[k])).join(' | '));
  ok('no Fit % badge on any of them', !Object.values(C).some(h => /Fit \d+%|tfit/.test(h)));
  ok('nor on the page with nothing said', !/Fit \d+%/.test(await page('/find-university')));
  ok('the compare table has no Fit row', !/\['Fit',/.test(require(path.join(ROOT, 'server', 'findpage.js')).FIND_PAGE_JS));
  /* A programme asking a German grade of 2.7 and no CGPA. */
  const g27 = { id: 'g', country: 'DE', isPublic: true, germanGpa: 2.7, minCgpa: null, reqs: {} };
  const v5 = FIND.verdict(g27, { cgpa: 5 }, REQS, {});
  const v75 = FIND.verdict(g27, { cgpa: 7.5 }, REQS, {});
  const v95 = FIND.verdict(g27, { cgpa: 9.5 }, REQS, {});
  ok('German grade 2.7 at CGPA 5: turned away, not "you clear"', v5.fails.some(f => f.key === 'cgpa') && !v5.ok, J(v5));
  ok('at CGPA 7.5: nobody can say without the pass mark', !v5.ok && !v75.ok && v75.unknown.includes('germanGrade') && !v75.fails.length, J(v75));
  ok('at CGPA 9.5: cleared', v95.ok, J(v95));
  ok('the row never says "You clear what it asks" at CGPA 5',
    !/You clear what it asks/.test(FIND.rowHtml(Object.assign({}, g27, { _v: v5, program: 'X', university: 'Y' }), { said: true, countries: {} })));
  const R5 = FIND.run([g27, Object.assign({}, g27, { id: 'h', germanGpa: 3.9 })], { cgpa: '5' }, REQS, {});
  ok('run(): the 2.7 row is not in the CGPA-5 list', !R5.rows.some(x => x.id === 'g') && R5.turned >= 1, J(R5.rows.map(x => x.id)));
  /* The destination's bar applies when the row states none (home + counsellor rule). */
  const noBar = { id: 'n', country: 'DE', isPublic: true, minCgpa: null, germanGpa: null, reqs: {} };
  ok('a row with no bar of its own takes the destination\'s', FIND.verdict(noBar, { cgpa: 6 }, REQS, { DE: { minCgpaPublic: 7.5 } }).fails.length === 1);

  /* ================================================ item 4: the 70 / 30 mix */
  console.log('\n— item 4: private 70 / public 30 on the first screen');
  const kinds = h => [...h.matchAll(/<article class="frow( locked)?"/g)].map(m => (m[1] ? 'pub' : 'priv'));
  for (const q of ['', '?country=DE']) {
    const k = kinds(await page('/find-university' + q)).slice(0, 20);
    const pub = k.filter(x => x === 'pub').length;
    ok('/find-university' + q + ': 6 of the first 20 rows are public (locked), 14 private and readable', pub === 6 && k.length === 20, k.join(','));
  }
  const free = kinds(await page('/find-university?apply=free'));
  ok('a fee filter is not mixed (free to apply → private only)', free.length && free.every(x => x === 'priv'));
  const mix = FIND.run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => ({ id: 'p' + i, country: 'DE', isPublic: i <= 5, level: 'master', field: 'x' })), {}, REQS, {});
  ok('run(): a public-first list is interleaved', J(mix.rows.slice(0, 5).map(x => x.isPublic)) === J([false, false, true, false, false]), J(mix.rows.map(x => x.isPublic)));
  ok('no "40 of N" count under the list', !/<span>\d+ of [\d,]+<\/span>/.test(await page('/find-university')));

  /* ===================================================== WEB-06: the search */
  console.log('\n— WEB-06: names, aliases and cities, signed out');
  for (const q of ['TU Munich', 'TUM', 'TU München', 'Bremen']) {
    const keys = (await req('anon', 'GET', '/api/find/unis?q=' + encodeURIComponent(q))).body.keys || [];
    const h = await page('/find-university?q=' + encodeURIComponent(q));
    const locked = (h.match(/frow locked/g) || []).length;
    ok('"' + q + '" names a university, and its public (locked) rows are found', keys.length >= 2 && locked >= (big ? 10 : 1), keys.length + ' keys, ' + locked + ' locked; ' + summary(h));
    ok('"' + q + '": the locked rows still carry no name', !/frow locked[\s\S]{0,400}(Technical University of Munich|University of Bremen)/.test(h));
  }
  const moiBox = nProg(await page('/find-university?moi=1'));
  ok('typed "MOI Accepted" = the MOI box', nProg(await page('/find-university?q=MOI%20Accepted')) === moiBox, moiBox);
  ok('the tag "MOI Accepted" = the MOI box', nProg(await page('/find-university?tags=MOI%20Accepted')) === moiBox);
  ok('the endpoint is open to a visitor', (await req('anon2', 'GET', '/api/find/unis?q=Bremen')).status === 200);

  /* ======================================== WEB-20.5 / .6 / .4 on the finder */
  console.log('\n— WEB-20: the finder\'s words');
  const empty = await page('/find-university?q=zzqqxxyy');
  ok('an empty search says the words are the cause', /Nothing matches that search — try fewer words/.test(empty) && !/Widen the CGPA/.test(empty));
  ok('an empty CGPA result still gives the CGPA advice', /Widen the CGPA/.test(FIND.emptyHtml({ cgpa: '5' })));
  const home = await page('/');
  const heroFields = [...((/<select id="fField">([\s\S]*?)<\/select>/.exec(home) || [])[1] || '').matchAll(/<option value="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const fp = await page('/find-university');
  const railFields = [...fp.matchAll(/name="field" value="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  ok('the finder\'s Field list starts with the hero\'s, in the hero\'s order (' + heroFields.length + ')',
    heroFields.length > 30 && J(railFields.slice(0, heroFields.length)) === J(heroFields), railFields.length + ' vs ' + heroFields.length);
  ok('Share falls back to a box, not prompt()', !/prompt\(/.test(require(path.join(ROOT, 'server', 'findpage.js')).FIND_PAGE_JS) && /function shareBox/.test(require(path.join(ROOT, 'server', 'findpage.js')).FIND_PAGE_JS));

  /* ====================================== WEB-05 / 13 / 14: university pages */
  console.log('\n— WEB-05 / 13 / 14: university pages');
  let uh = await page('/university/rwth-aachen-university');
  const site = (/href="([^"]+)" target="_blank" rel="noopener nofollow">Official site/.exec(uh) || [])[1];
  if (big) ok('RWTH: Official site is rwth-aachen.de, not femp.org', /^https:\/\/www\.rwth-aachen\.de/.test(site || ''), site);
  ok('RWTH: no "₹0 to" in the total cost', !/₹0 to/.test(uh));
  if (big) ok('RWTH: the free end is said in words', /No tuition fee on some programmes; others up to ₹/.test(uh));
  ok('the gold Apply buttons are navy on gold', /\.btn-gold,\.btn-gold:hover,\.btn-gold:focus\{color:#0b1f3a\}/.test(uh));
  r = await req('a', 'GET', '/api/staff/university/rwth-aachen-university');
  ok('the editor is told what an empty box means', 'derivedWebsite' in r.body, J(Object.keys(r.body)));
  const keepX = r.body.extras || {};
  r = await req('a', 'PUT', '/api/staff/university/rwth-aachen-university', Object.assign({}, keepX, { website: 'not a site' }));
  ok('a website that is not an address is refused', r.status === 422, r.status + ' ' + r.text.slice(0, 80));
  r = await req('a', 'PUT', '/api/staff/university/rwth-aachen-university', Object.assign({}, keepX, { website: 'https://www.rwth-aachen.de/go/id/a/' }));
  uh = await page('/university/rwth-aachen-university');
  ok('the office\'s address wins', r.status === 200 && /href="https:\/\/www\.rwth-aachen\.de\/go\/id\/a\/" target="_blank" rel="noopener nofollow">Official site/.test(uh), r.status);
  await req('a', 'PUT', '/api/staff/university/rwth-aachen-university', Object.assign({}, keepX, { website: '' }));
  const cat = fs.readFileSync(path.join(ROOT, 'catalogue.html'), 'utf8'), catPy = fs.readFileSync(path.join(ROOT, 'portal_catalogue.py'), 'utf8');
  ok('the University pages editor has the box (catalogue.html and portal_catalogue.py alike)',
    /id="uWebsite"/.test(cat) && /website: \$\('#uWebsite'\)/.test(cat) && /id="uWebsite"/.test(catPy) && /website: \$\('#uWebsite'\)/.test(catPy));

  /* ========================================================= WEB-08: country */
  console.log('\n— WEB-08: country pages');
  const uk = await page('/study-in-united-kingdom');
  ok('UK: no "0 at public universities"', !/0 at public universit/.test(uk));
  ok('UK: no sentence about what public universities charge', !/Public universities here/.test(uk));
  const it = await page('/study-in-italy');
  ok('Italy: no "1 programmes"', !/\b1 programmes\b/.test(it));
  const body = s => s.slice(s.indexOf('<section class="page-hero"'), s.lastIndexOf('<footer'));
  ok('no western-grouped rupees on the country pages', ![uk, it, await page('/study-in-germany')].some(h => /₹\d{1,3}(,\d{3}){2,}/.test(body(h))));
  ok('lakh is written as lakh (₹12 lakh)', /₹12 lakh/.test(body(uk)));
  ok('and never "₹14.0 lakh"', !/₹\d+\.0 (lakh|crore)/.test(body(it) + body(uk)));
  const de = await page('/study-in-germany');
  if (big) ok('Germany keeps its public sentence', /at public universities\./.test(de) && /Public universities here/.test(de));

  /* ============================================================ WEB-10: refer */
  console.log('\n— WEB-10: refer a friend');
  const rf = await page('/refer');
  ok('no promise of a referral link', !/referral link|through your link/i.test(rf));
  ok('a "Tell us who you referred" form with a sign-up button', /Tell us who you referred/.test(rf) && /id="rfForm"/.test(rf) && /login\.html\?signup=1/.test(rf));
  const stamp = Date.now().toString().slice(-6);
  r = await req('ref', 'POST', '/send.php', { name: 'Friend ' + stamp, phone: '98765' + stamp.slice(0, 5), email: 'friend' + stamp + '@example.com', source: 'referral', consent: 'yes', note: 'Referred by Asha (9876500000)' });
  ok('a referral is accepted', r.status === 200, r.status + ' ' + r.text.slice(0, 100));
  const leads = (await req('a', 'GET', '/api/staff/leads')).body.leads || [];
  const lead = leads.find(l => String(l.email || '').includes('friend' + stamp));
  ok('and lands in Leads as a referral, with who sent it', lead && lead.source === 'referral' && /Asha/.test(J(lead)), J(lead).slice(0, 200));
  r = await req('ref2', 'POST', '/send.php', { name: '12345', phone: '9876543210', email: 'x@example.com', source: 'referral', consent: 'yes' });
  ok('a numeric name is refused there too', r.status === 422);

  /* =========================================================== WEB-11: plans */
  console.log('\n— WEB-11: the work-abroad split');
  const wl = PLANS.phasesFor({ tab: 'work' }).map(x => x.label);
  ok('a work package is split by documents filed and visa in hand', J(wl) === J(['To start', 'When your documents are filed', 'When your visa is in hand']), J(wl));
  ok('a study package keeps its own words', /applications go in/.test(J(PLANS.phasesFor({ tab: 'study' }))));
  ok('the home page carries the same words', /PART_PHASES_WORK = \[[\s\S]*When your documents are filed[\s\S]*When your visa is in hand/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));

  /* ======================================================= WEB-15: the names */
  console.log('\n— WEB-15: a name has a letter');
  r = await req('su', 'POST', '/api/auth/signup', { name: '12345', email: 'n' + stamp + '@example.com', phone: '9876543210', password: 'longenough1', terms: true });
  ok('sign-up refuses "12345"', r.status === 422 && /letter/.test(r.body.error || ''), r.status + ' ' + r.text.slice(0, 80));
  const priv = ((await req('anon', 'GET', '/api/catalogue')).body.programmes || []).find(p => !p.isPublic && p.university);
  r = await req('ap', 'POST', '/api/apply', { id: priv && priv.id, name: '12345', email: 'a' + stamp + '@example.com', phone: '9876543210', consent: 'apply' });
  ok('/api/apply refuses "12345"', r.status === 422 && /letter/.test(r.body.error || ''), r.status + ' ' + r.text.slice(0, 80));
  ok('the university page form checks it before sending', /A name needs at least one letter\./.test(await page('/university/rwth-aachen-university')) || /A name needs at least one letter/.test(fs.readFileSync(path.join(ROOT, 'serve.js'), 'utf8')));

  /* ====================================================== WEB-17: the stories */
  console.log('\n— WEB-17: one admissions count');
  const ss = await page('/success-stories');
  const nStories = Number(((/(\d[\d,]*) admission offers/.exec(ss) || [])[1] || '0').replace(/,/g, ''));
  const nHome = Number(((/<b data-count data-src="stories">(\d+)<\/b>/.exec(home) || [])[1]) || -1);
  ok('home "See all N admissions" = the stories page (' + nStories + ')', nStories > 0 && nHome === nStories, nHome + ' vs ' + nStories);

  /* =========================================================== WEB-18: SOP */
  console.log('\n— WEB-18: the SOP joins');
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'content.json'), 'utf8')).writing;
  let txt = '';
  for (let pass_ = 0; pass_ < 4; pass_++) {
    const d = WRITING.draft(bank, { kind: 'sop', programme: 'M.Sc. Data Science', university: 'TU Munich', signals: ['project'], details: { project: 'Built a fraud-detection model on 2 lakh UPI transactions.' } }, pass_);
    txt += d.paragraphs.join('\n') + '\n';
  }
  ok('the inserted clause is lower-cased', /built a fraud-detection model/.test(txt) && !/: Built a fraud/.test(txt));
  ok('the input label is not repeated in front of it', !/my final-year project — /.test(txt));
  ok('no doubled full stop', !/transactions\.\./.test(txt));
  ok('"is built" does not happen', !/ is built a fraud/.test(txt), (txt.match(/.{30}built a fraud.{10}/) || [''])[0]);
  ok('an acronym keeps its capitals', /TCS/.test(WRITING.draft(bank, { kind: 'sop', signals: ['work'], details: { work: 'TCS, two years on payments' } }, 0).paragraphs.join(' ')));

  /* ========================================================= WEB-20.2 / .3 */
  console.log('\n— WEB-20: posts API and meta');
  /* A published post by a Wix-style handle, so there is something to read. */
  const words = Array.from({ length: 320 }, (_, i) => ['Germany', 'public', 'universities', 'admit', 'students', 'with', 'a', 'clear', 'profile'][i % 9]).join(' ');
  r = await req('a', 'POST', '/api/staff/posts', { title: 'Round 169 byline check ' + stamp, slug: 'r169-byline-' + stamp, body: words + '.\n\n' + words + '.',
    excerpt: 'A post for the byline check.', author: 'maurya2pi', status: 'published', tag: 'Germany' });
  ok('a post by "maurya2pi" is published for the check', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
  const ph = await page('/post/r169-byline-' + stamp);
  ok('WEB-20.7: its byline is not the handle', !/By <b>maurya2pi<\/b>/.test(ph) && /By <b>Glovels Editorial Team<\/b>/.test(ph), (ph.match(/By <b>[^<]*/) || [''])[0]);
  const posts = (await req('anon', 'GET', '/api/posts')).body.posts || [];
  ok('/api/posts says nothing about who edited a post', posts.length > 0 && posts.every(p => !('updatedBy' in p)), posts.length);
  if (posts[0]) ok('/api/posts/<slug> neither', !('updatedBy' in ((await req('anon', 'GET', '/api/posts/' + posts[0].slug)).body.post || { updatedBy: 1 })));
  const metaOf = h => ({ title: ((/<title>([^<]*)<\/title>/.exec(h) || [])[1] || '').replace(/&amp;/g, '&'),
    desc: ((/<meta name="description" content="([^"]*)"/.exec(h) || [])[1] || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") });
  const sample = ['/university/rwth-aachen-university', '/university/technical-university-of-munich', '/find-university?country=DE&level=master&field=Computer%20Science%20%26%20IT', '/success-stories'];
  if (posts[0]) sample.push('/post/' + posts[0].slug);
  for (const p of sample) {
    const m = metaOf(await page(p));
    ok(p + ': title ≤ 65, description ≤ 160', m.title.length > 0 && m.title.length <= 65 && m.desc.length <= 160, m.title.length + ' / ' + m.desc.length + ' — ' + m.title);
  }
  const lg = await page('/login');
  ok('/login has a description and an og:image', /<meta name="description" content="[^"]{40,160}"/.test(lg) && /property="og:image"/.test(lg));
  ok('/success-stories has an og:image', /property="og:image" content="[^"]+"/.test(ss));
  ok('login: every input has a linked label', ['lName', 'lEmail', 'lPhone', 'lPass'].every(id => new RegExp('<label for="' + id + '"').test(lg)));

  /* ========================================================= W17 / STU-08 */
  console.log('\n— W17 / STU-08: sign-out leaves nothing');
  r = await req('a', 'POST', '/api/auth/logout');
  ok('sign-out marks itself for the sign-in page (glv_out)', r.set.some(c => /^glv_out=1/.test(c)), J(r.set));
  r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });

  /* ================================================= item 5: More Services */
  console.log('\n— item 5: More Services');
  const svc = (await req('anon', 'GET', '/api/content')).body.services || {};
  const sItems = svc.items || svc || [];
  const byId = id => (Array.isArray(sItems) ? sItems : []).find(s => s.id === id) || {};
  /* 15 Oct report (item 4): they are back in Most Booked as well — round172webtest. */
  ok('CV, Book Counselling and APS are under More Services (and, since 15 Oct, Most Booked too)',
    ['cv', 'counsel', 'aps'].every(id => (byId(id).cats || []).includes('more') && (byId(id).cats || []).includes('top')),
    J(['cv', 'counsel', 'aps'].map(id => byId(id).cats)));
  ok('the rest of Most Booked is untouched', ['sop', 'lor', 'visa'].every(id => (byId(id).cats || []).includes('top')));

  /* ===================================================== in the browser */
  console.log('\n— in the browser');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2500);
    ok('desktop: Find University is a visible button in the header', await pg.isVisible('nav.menu a.nav-find'));
    const bg = await pg.$eval('nav.menu a.nav-find', a => getComputedStyle(a).backgroundColor);
    ok('… with a filled background', bg !== 'rgba(0, 0, 0, 0)', bg);
    await pg.click('[data-cat="more"]');
    await pg.waitForTimeout(300);
    const moreCards = await pg.$$eval('#svcGrid > *', els => els.map(e => e.textContent));
    ok('the More Services tab shows the three', moreCards.length === 3 && /Academic CV/.test(moreCards.join()) && /APS/.test(moreCards.join()) && /Book Counselling/.test(moreCards.join()), moreCards.length);
    await pg.click('[data-cat="top"]');
    await pg.waitForTimeout(300);
    const topCards = await pg.$$eval('#svcGrid > *', els => els.map(e => e.textContent).join(' | '));
    ok('and Most Booked shows them again (15 Oct, item 4)', /Academic CV/.test(topCards) && /APS, Attestation/.test(topCards) && /Book Counselling/.test(topCards));
    /* Item 1: fifteen rows, both before and after the filters are touched. */
    const rowsUntouched = await pg.$$eval('#rowsIn .mrow', els => els.length);
    ok('the home list shows at most 15 rows', rowsUntouched > 0 && rowsUntouched <= 15, rowsUntouched);
    await pg.selectOption('#fCountry', 'DE');
    await pg.waitForTimeout(800);
    for (const t of await pg.$$('.rtab:not([hidden])')) {
      await t.click(); await pg.waitForTimeout(300);
      const n = await pg.$$eval('#rowsIn .mrow', els => els.length);
      ok('with Germany chosen, the "' + (await t.getAttribute('data-rt')) + '" tab still shows at most 15', n > 0 && n <= 15, n);
    }
    /* Item 2: the button. */
    const btn = await pg.$eval('#rFind', a => ({ cls: a.className, w: a.getBoundingClientRect().width, fs: parseFloat(getComputedStyle(a).fontSize), after: !!a.closest('.rmore-cta') }));
    ok('"More universities" is a primary (gold) button of its own after the list', /btn-gold/.test(btn.cls) && btn.after && btn.fs >= 16 && btn.w >= 300, J(btn));
    /* WEB-20.9: the WhatsApp corner hides while a modal is open. */
    await pg.evaluate(() => { const m = document.querySelector('.modal'); m.classList.add('on'); });
    const cornerShown = await pg.evaluate(() => [...document.querySelectorAll('.gv-corner,.wa-launch')].some(e => getComputedStyle(e).display !== 'none'));
    ok('the WhatsApp button is hidden while a dialog is open', !cornerShown);
    await pg.evaluate(() => document.querySelector('.modal.on').classList.remove('on'));
    const cornerBack = await pg.evaluate(() => [...document.querySelectorAll('.gv-corner')].some(e => getComputedStyle(e).display !== 'none'));
    ok('and back when it closes', cornerBack);
    ok('no script errors on the home page', !errs.length, errs.join(' | '));

    /* Phone width. */
    const mob = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true });
    const mp = await mob.newPage();
    await mp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await mp.waitForTimeout(2000);
    const mw = await mp.evaluate(() => { const a = document.getElementById('rFind'); const c = a.closest('.rmore-cta'); return [a.getBoundingClientRect().width, c.getBoundingClientRect().width]; });
    ok('phone: "More universities" is full width', mw[0] >= mw[1] - 40, J(mw));
    await mp.click('#burger');
    await mp.waitForTimeout(400);
    ok('phone: the menu has the Find University button', await mp.isVisible('.mobile-menu a.nav-find'));
    ok('phone: and no About Us', !(await mp.$$eval('.mobile-menu > a', as => as.map(a => a.textContent.trim()))).includes('About Us'));

    /* WEB-16 + WEB-15 on the sign-in page. */
    const lp = await ctx.newPage();
    await lp.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await lp.click('#tab-signup');
    await lp.fill('#lName', '12345');
    await lp.click('#submit-btn');
    await lp.waitForTimeout(200);
    ok('sign-up: "12345" is refused in the page', await lp.$eval('#lName', i => i.closest('.field').classList.contains('bad')) && /letter/.test(await lp.textContent('#lNameErr')));
    ok('sign-up: the terms message shows', await lp.isVisible('#termsErr'));
    await lp.fill('#lName', 'Asha');
    ok('typing clears that field\'s error', !(await lp.$eval('#lName', i => i.closest('.field').classList.contains('bad'))));
    await lp.click('#tab-signin');
    ok('changing tab clears the rest', !(await lp.isVisible('#termsErr')) && (await lp.$$('#authForm .field.bad')).length === 0);

    /* W17: sign out, land on the sign-in page, nothing left. */
    await lp.evaluate(() => { localStorage.setItem('glovels_order', '{"ref":"GLV-1"}'); localStorage.setItem('glovels_shortlist', '[1,2]'); localStorage.setItem('glv-saved', '["a"]'); localStorage.setItem('other_key', 'stays'); });
    await lp.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }));
    await lp.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    const left = await lp.evaluate(() => Object.keys(localStorage));
    ok('after sign-out every glovels_* and glv-* key is gone', !left.some(k => /^(glovels|glv)/.test(k)) && left.includes('other_key'), J(left));
    /* Signing in as somebody else clears them too. */
    await lp.evaluate(() => { localStorage.setItem('glovels_user', JSON.stringify({ email: 'someone.else@example.com' })); localStorage.setItem('glovels_order', 'x'); });
    await lp.fill('#lEmail', 'admin@glovels.com'); await lp.fill('#lPass', 'glovels123');
    await Promise.all([lp.waitForNavigation({ timeout: 15000 }).catch(() => {}), lp.click('#submit-btn')]);
    const left2 = await lp.evaluate(() => Object.keys(localStorage).filter(k => /^glovels_order$/.test(k)));
    ok('signing in as a different person clears the last one\'s order', !left2.length, J(left2));

    /* WEB-10: the refer form, end to end. */
    const rp = await ctx.newPage();
    await rp.goto(BASE + '/refer', { waitUntil: 'domcontentloaded' });
    await rp.fill('#rfName', '12345'); await rp.click('#rfGo');
    ok('refer: a numeric name is refused in the page', /letter/.test(await rp.textContent('#rfErr')));
    const s2 = String(Date.now()).slice(-5);
    await rp.fill('#rfName', 'Ravi Kumar'); await rp.fill('#rfPhone', '91234' + s2); await rp.fill('#rfMail', 'ravi' + s2 + '@example.com');
    await rp.fill('#rfMyName', 'Asha Rao'); await rp.fill('#rfMyPhone', '98765' + s2); await rp.check('#rfOk');
    await rp.click('#rfGo');
    await rp.waitForSelector('#rfSent', { timeout: 8000 }).catch(() => {});
    ok('refer: the form sends and says thank you', await rp.isVisible('#rfSent'));

    /* WEB-20.4: share with no clipboard. */
    /* A visitor — the context above is signed in as the administrator now,
       and an administrator sees public names rather than locked rows. */
    const fpg = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
    await fpg.addInitScript(() => { try { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); } catch (e) {} });
    let prompted = false;
    fpg.on('dialog', d => { prompted = true; d.dismiss(); });
    await fpg.goto(BASE + '/find-university?country=DE', { waitUntil: 'domcontentloaded' });
    await fpg.waitForTimeout(1500);
    await fpg.click('#fshare');
    await fpg.waitForTimeout(300);
    ok('Share with no clipboard: an inline box with the link, no prompt()', !prompted && await fpg.isVisible('#fshareBox') && /find-university\?country=DE/.test(await fpg.inputValue('#fshareLink')));
    /* WEB-06 in the browser: the client re-render keeps the locked TUM rows. */
    await fpg.goto(BASE + '/find-university?q=' + encodeURIComponent('TU Munich'), { waitUntil: 'domcontentloaded' });
    await fpg.waitForFunction(() => document.querySelectorAll('#flist .frow.locked').length > 0, null, { timeout: 15000 }).catch(() => {});
    await fpg.waitForTimeout(1500);
    const lockedLive = await fpg.$$eval('#flist .frow.locked', els => els.length);
    ok('browser: "TU Munich" keeps the locked public rows after the live re-render', lockedLive >= 1, lockedLive);
    await browser.close();
  } catch (e) {
    ok('the browser checks ran', false, e.stack);
    try { await browser.close(); } catch (e2) {}
  }

  console.log('round169webtest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('round169webtest: ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
