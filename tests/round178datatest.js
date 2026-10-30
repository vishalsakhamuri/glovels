/*
 * Round 178 (30 Oct package) — the data round.
 *
 *   1. `fee indicative`: a fee from an agent portal (Crizac, ApplyBoard,
 *      UCOL) is the counsellor's — staff see it with the flag; a visitor or
 *      a student never sees it: not in /api/catalogue, /api/find/locked,
 *      /api/universities/filter (budget), the student's shortlist, the
 *      university page or the destination page.
 *   2. `awarding body` is stored, exported and read back.
 *   3. The import: "if already on the site = update" turns a blank-id
 *      duplicate into an update of the row already there (and without the
 *      column it is still refused); a column the sheet does not carry is
 *      left as it is ("on the site" — a hidden row stays hidden).
 *   4. A slice of every upload sheet this round produced imports clean
 *      (Germany v43, France, UK, USA, Canada, Ireland, Australia).
 *   5. USA and Australia are destinations with programmes on their pages.
 *   6. /success-stories: 109 + 13 cards, no student twice in four, no
 *      surnames or scores in the source, the brief's title / description,
 *      valid JSON-LD (BreadcrumbList + two ItemLists), every logo loads;
 *      the home "Real journeys" rail is the same cards, with no count.
 *
 * Port 8133 by default (BASE overrides). The upload sheets are read from
 * the session scratchpad (UPLOAD_DIR overrides); a sheet that is not on
 * this machine is skipped, not failed.
 */
const fs = require('fs');
const path = require('path');
const SHEET = require('../server/sheet.js');
const BASE = process.env.BASE || 'http://localhost:8133';
const UP = process.env.UPLOAD_DIR || '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad/oct30/upload';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); } };
function done() { console.log('round178datatest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {};
async function req(who, method, p, body, raw) {
  const h = {};
  if (!raw && body !== undefined) h['content-type'] = 'application/json';
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: raw ? body : (body === undefined ? undefined : JSON.stringify(body)) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const buf = Buffer.from(await r.arrayBuffer());
  const text = buf.toString('utf8'); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {}, text, buf, type: r.headers.get('content-type') || '' };
}
async function upload(who, name, headers, rows, confirm) {
  const fd = new FormData();
  const data = /\.csv$/.test(name) ? Buffer.from(SHEET.writeCsv(headers, rows), 'utf8') : SHEET.writeXlsx(headers, rows, 'Catalogue');
  fd.append('file', new Blob([data]), name);
  if (confirm) { fd.append('confirm', 'yes'); fd.append('skipBad', 'yes'); }
  return req(who, 'POST', '/api/staff/catalogue/import', fd, true);
}
const stamp = String(Date.now()).slice(-6);
const money = n => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(n % 1e7 ? 1 : 0).replace(/\.0$/, '') + ' crore'
  : '₹' + (n / 1e5).toFixed(n % 1e5 ? 1 : 0).replace(/\.0$/, '') + ' lakh');

(async () => {
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.ok, r.status);

  /* ============================================ 1-2. the flag, the body */
  console.log('\n— fee indicative + awarding body');
  const UNI = 'Testbridge Agent College ' + stamp;      // private, CA: named to everyone
  const PUB = 'Testburg Public University ' + stamp;     // public, DE: locked for visitors
  const FEE = 2345670, FEE2 = 1234560, FEE3 = 3456780;
  const H = ['id', 'programme', 'university', 'city', 'country code', 'level', 'field', 'public university',
    'application', 'total tuition inr', 'course url', 'tuition eur per sem', 'fee indicative', 'awarding body', 'on the site'];
  const rows = [
    ['', 'MSc Agent Data ' + stamp, UNI, 'Toronto', 'CA', 'master', 'Data Science, AI & Machine Learning', 'no', 'Free', FEE, 'https://example.org/a', '', 'yes', 'Lancaster University (UK)', 'yes'],
    ['', 'MSc Direct Data ' + stamp, UNI, 'Toronto', 'CA', 'master', 'Data Science, AI & Machine Learning', 'no', 'Free', FEE2, 'https://example.org/b', '', 'no', '', 'yes'],
    ['', 'MSc Locked Agent ' + stamp, PUB, 'Testburg', 'DE', 'master', 'Computer Science & IT', 'yes', 'Package', FEE3, 'https://example.org/c', 9876, 'yes', '', 'yes'],
  ];
  r = await upload('a', 'flag.xlsx', H, rows, false);
  ok('the preview reads the new columns (nothing unknown, nothing refused)',
    r.ok && r.body.counts && r.body.counts.create === 3 && r.body.counts.rejected === 0 && !(r.body.plan.unknownColumns || []).length, r.body.counts || r.body);
  r = await upload('a', 'flag.xlsx', H, rows, true);
  ok('applied: three rows added', r.ok && r.body.created === 3, r.body);

  r = await req('a', 'GET', '/api/staff/catalogue?per=50&q=' + encodeURIComponent(stamp));
  const staffRows = r.body.programmes || [];
  const sInd = staffRows.find(p => /Agent Data/.test(p.program));
  const sDir = staffRows.find(p => /Direct Data/.test(p.program));
  const sPub = staffRows.find(p => /Locked Agent/.test(p.program));
  ok('staff see the indicative fee AND the flag', sInd && sInd.totalInr === FEE && sInd.feeIndicative === true, sInd);
  ok('staff: a direct fee is not flagged', sDir && sDir.totalInr === FEE2 && sDir.feeIndicative === false, sDir);
  ok('awarding body is stored', sInd && sInd.awardingBody === 'Lancaster University (UK)', sInd && sInd.awardingBody);
  ok('staff /api/catalogue carries the fee with the flag', ((await req('a', 'GET', '/api/catalogue')).body.programmes || [])
    .some(p => p.id === sInd.id && p.totalInr === FEE && p.feeIndicative === true));

  r = await req('a', 'GET', '/api/staff/catalogue.csv?country=CA');
  const csv = SHEET.toObjects(SHEET.readCsv(r.text));
  const ex = csv.find(o => String(o.id) === String(sInd.id));
  ok('the download carries "fee indicative" and "awarding body"', ex && /^yes$/i.test(ex['fee indicative']) && ex['awarding body'] === 'Lancaster University (UK)', ex);
  /* Round trip: the downloaded row, uploaded unchanged, is unchanged. */
  const csvHead = SHEET.readCsv(r.text)[0];
  const back = csv.filter(o => String(o.id) === String(sInd.id)).map(o => csvHead.map(h => o[h]));
  r = await upload('a', 'roundtrip.csv', csvHead, back, false);
  ok('a downloaded row comes back "already right"', r.ok && r.body.counts && r.body.counts.unchanged === 1 && r.body.counts.update === 0, r.body.counts || r.body);
  /* Flipping only the flag is seen as a change. */
  const fi = csvHead.indexOf('fee indicative');
  r = await upload('a', 'flip.csv', csvHead, back.map(x => x.map((v, i) => (i === fi ? 'no' : v))), false);
  ok('a flipped flag alone is a change', r.ok && r.body.counts && r.body.counts.update === 1
    && ((r.body.plan.update[0] || {}).changed || []).includes('feeIndicative'), r.body.plan && r.body.plan.update);

  /* The visitor. */
  r = await req('v', 'GET', '/api/catalogue');
  const vRows = r.body.programmes || [];
  const vInd = vRows.find(p => p.id === sInd.id);
  const vDir = vRows.find(p => p.id === sDir.id);
  ok('visitor: the indicative row is there, its fee is not (0, feeHidden, no band)',
    vInd && vInd.totalInr === 0 && vInd.feeHidden === true && !vInd.band, vInd);
  ok('visitor: no per-semester figure either', vInd && (!vInd.reqs || vInd.reqs.tuitionEurSem == null));
  ok('visitor: a direct fee is still shown', vDir && vDir.totalInr === FEE2);
  ok('visitor: the indicative figure appears nowhere in /api/catalogue', !r.text.includes(String(FEE)) && !r.text.includes(String(FEE3)));
  r = await req('v', 'GET', '/api/find/locked?country=DE');
  ok('visitor: /api/find/locked never carries an indicative fee', r.ok && !r.text.includes(String(FEE3)) && !r.text.includes('9876'), r.status);
  const lockedMine = (r.body.locked || []).filter(p => p.feeHidden);
  ok('visitor: a locked indicative row says feeHidden and 0', lockedMine.every(p => !p.totalInr));
  r = await req('v', 'GET', '/api/find/locked?country=CA&budget=u20');
  ok('visitor: /api/find/locked by budget does not narrow on it', !r.text.includes(String(FEE)));
  r = await req('v', 'GET', '/api/universities/filter?country=CA&budget=2400000');
  ok('visitor: a budget on the destination filter does not find the indicative-only fee', r.ok
    && !(r.body.universities || []).some(u => u.name === UNI && u.feeMin === FEE), r.body);

  const slug = UNI.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  r = await req('v', 'GET', '/university/' + slug);
  ok('university page renders', r.status === 200, r.status);
  ok('university page: "Fees from a counsellor" on the indicative row', /Fees from a counsellor/.test(r.text));
  ok('university page: the indicative fee is not printed', !r.text.includes(money(FEE)) && !r.text.includes(String(FEE)), money(FEE));
  ok('university page: the direct fee still is', r.text.includes(money(FEE2)), money(FEE2));
  r = await req('v', 'GET', '/study-in-canada');
  ok('destination page: no indicative fee', r.status === 200 && !r.text.includes(money(FEE)));

  /* The student. */
  r = await req('s', 'POST', '/api/auth/login', { email: 'student@glovels.com', password: 'glovels123' });
  ok('student signs in', r.ok, r.status);
  r = await req('s', 'GET', '/api/catalogue');
  ok('student: no indicative figure in their catalogue', r.ok && !r.text.includes(String(FEE)) && !r.text.includes(String(FEE3)));
  r = await req('s', 'POST', '/api/shortlist', { id: sInd.id });
  ok('student adds the (private) indicative programme', r.ok, r.status + ' ' + r.text.slice(0, 120));
  r = await req('s', 'GET', '/api/state');
  const sl = (r.body.shortlist || []).find(x => x.id === sInd.id);
  ok('student: their shortlist row has no fee and says so', sl && !sl.totalInr && sl.feeHidden === true, sl);
  ok('student: the figure appears nowhere in /api/state', !r.text.includes(String(FEE)));

  /* ======================================== 3. upsert and absent columns */
  console.log('\n— "if already on the site", absent columns');
  const H2 = ['id', 'programme', 'university', 'city', 'country code', 'level', 'field', 'public university', 'application', 'total tuition inr'];
  const twin = ['', 'MSc Agent Data ' + stamp, UNI, 'Toronto', 'CA', 'master', 'Data Science, AI & Machine Learning', 'no', 'Free', 2500000];
  r = await upload('a', 'twin.xlsx', H2, [twin], false);
  ok('without the column, a blank-id twin is refused', r.ok && r.body.counts.rejected === 1 && r.body.counts.create === 0, r.body.counts);
  r = await upload('a', 'twin.xlsx', H2.concat(['if already on the site']), [twin.concat(['update'])], false);
  ok('with "if already on the site = update" it updates the row already there', r.ok && r.body.counts.update === 1
    && r.body.counts.create === 0 && r.body.counts.matched === 1 && (r.body.plan.update[0] || {}).id === sInd.id, r.body.counts);
  /* Hide the row, then upload a sheet with no "on the site" column. */
  r = await upload('a', 'hide.xlsx', ['id'].concat(H2.slice(1), ['on the site']), [[sInd.id].concat(twin.slice(1, -1), [2400000, 'no'])], true);
  r = await upload('a', 'twin.xlsx', H2.concat(['if already on the site']), [twin.concat(['update'])], true);
  ok('applied: updated, nothing added', r.ok && r.body.updated === 1 && r.body.created === 0, r.body);
  r = await req('a', 'GET', '/api/staff/catalogue?per=50&status=&q=' + encodeURIComponent(stamp));
  const after = (r.body.programmes || []).filter(p => /Agent Data/.test(p.program));
  ok('still ONE row for that course', after.length === 1, after.length);
  ok('a sheet without "on the site" left the hidden row hidden', after[0] && after[0].active === false, after[0] && after[0].active);
  ok('… and without "fee indicative" kept the flag', after[0] && after[0].feeIndicative === true);
  ok('… and the fee it carried was written', after[0] && after[0].totalInr === 2500000);
  ok('… and the awarding body was kept', after[0] && after[0].awardingBody === 'Lancaster University (UK)');

  /* ===================================== 4. a slice of every upload sheet */
  console.log('\n— the upload sheets (a slice of each)');
  const files = fs.existsSync(UP) ? fs.readdirSync(UP).filter(f => /^glovels-.*\.xlsx$/.test(f) && !/report/.test(f)) : [];
  if (!files.length) console.log('  (no upload sheets on this machine — skipped)');
  const got = {};
  for (const f of files.sort()) {
    const all = SHEET.readXlsx(fs.readFileSync(path.join(UP, f)));
    const head = all[0];
    const idI = head.indexOf('id');
    /* Live ids do not exist on a test server, so only blank-id lines go up. */
    const body = all.slice(1).filter(x => !String(x[idI] == null ? '' : x[idI]).trim()).slice(0, 25);
    if (!body.length) { console.log('  (' + f + ': no blank-id lines)'); continue; }
    r = await upload('a', f, head, body, false);
    const c = r.body.counts || {};
    ok(f + ': ' + body.length + ' lines preview with nothing refused', r.ok && c.rejected === 0 && (c.create + c.update + c.unchanged) === body.length, c);
    const unknown = (r.body.plan && r.body.plan.unknownColumns) || [];
    ok(f + ': every column but the reader\'s note is understood', unknown.every(u => /^(source|s\.no \(v43\))$/.test(u)), unknown);
    r = await upload('a', f, head, body, true);
    ok(f + ': applied', r.ok && r.body.applied, r.body);
    r = await upload('a', f, head, body, false);
    ok(f + ': uploaded a second time it adds nothing', r.ok && r.body.counts && r.body.counts.create === 0 && r.body.counts.rejected === 0, r.body.counts);
    const ccI = head.indexOf('country code');
    body.forEach(x => { got[x[ccI]] = true; });
    const fiI = head.indexOf('fee indicative');
    if (/germany/.test(f)) ok(f + ': German fees are not indicative', body.every(x => /^no$/i.test(String(x[fiI]))));
    else if (!/france/.test(f)) ok(f + ': agent-portal fees are indicative', body.every(x => /^yes$/i.test(String(x[fiI]))));
  }

  /* ======================================== 5. USA and Australia */
  console.log('\n— USA and Australia');
  r = await req('a', 'GET', '/api/staff/catalogue?per=1');
  const cs = r.body.countries || [];
  for (const [cc, slugC] of [['US', 'study-in-usa'], ['AU', 'study-in-australia']]) {
    const c = cs.find(x => x.code === cc);
    ok(cc + ' is an active destination', c && c.active, c);
    if (!got[cc]) {
      /* No sheet on this machine: one row of our own, so the page check runs. */
      await upload('a', cc + '.xlsx', H2.concat(['fee indicative', 'on the site']),
        [['', 'MSc Test ' + cc + ' ' + stamp, 'Test ' + cc + ' University ' + stamp, 'Somewhere', cc, 'master', 'Business & Management', 'no', 'Free', 3000000, 'yes', 'search']], true);
    }
    r = await req('a', 'GET', '/api/staff/catalogue?per=1');
    const c2 = (r.body.countries || []).find(x => x.code === cc);
    ok(cc + ' has programmes', c2 && c2.programmes > 0, c2 && c2.programmes);
    r = await req('v', 'GET', '/' + slugC);
    ok(slugC + ' lists its universities', r.status === 200 && /<h2 id="universities">Universities in /.test(r.text) && /href="university\//.test(r.text));
    ok(slugC + ' prints no indicative fee', !/· from ₹/.test((r.text.split('<h2 id="universities">')[1] || '').split('</ul>')[0]));
  }

  /* ========================================= 6. success stories */
  console.log('\n— /success-stories');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'success-stories.json'), 'utf8'));
  ok('the shipped file carries only admits and routes', Object.keys(data).sort().join(',') === 'admits,routes', Object.keys(data));
  ok('109 admits and 13 routes in the file', data.admits.length === 109 && data.routes.length === 13);
  r = await req('v', 'GET', '/success-stories');
  const ss = r.text;
  ok('page renders', r.status === 200, r.status);
  ok('title is the brief\'s, cut to 65', /<title>Success stories — 109 admits &amp; visa approvals \| Glovels<\/title>/.test(ss),
    (/<title>[^<]*<\/title>/.exec(ss) || [])[0]);
  const descM = /<meta name="description" content="([^"]*)">/.exec(ss);
  ok('description keeps the brief\'s facts within 160', descM && descM[1] === '69 students, 109 admission offers at 51 universities, plus Germany Opportunity Cards, an EU Blue Card and UK Young Professionals visa approvals.'
    && descM[1].length <= 160, descM && descM[1]);
  const ogT = /<meta property="og:title" content="([^"]*)"/.exec(ss);
  ok('og:title in step with the title', !ogT || /109 admits &amp; visa approvals/.test(ogT[1]), ogT && ogT[1]);
  ok('canonical names /success-stories', /<link rel="canonical" href="[^"]*\/success-stories">/.test(ss));
  const grid = (ss.split('id="admit-stories"')[1] || '').split('id="visa-work-stories"')[0];
  const names = [...grid.matchAll(/<span class="ss-who">([^<]*)<\/span>/g)].map(m => m[1]);
  ok('109 admit cards, server-rendered', names.length === 109, names.length);
  const routesHtml = (ss.split('id="visa-work-stories"')[1] || '').split('class="ss-cta"')[0];
  ok('13 visa / work-route cards', (routesHtml.match(/class="ss-card ss-route"/g) || []).length === 13);
  let clash = null;
  names.forEach((n, i) => { for (let k = Math.max(0, i - 3); k < i; k++) if (names[k] === n && !clash) clash = [i, n]; });
  ok('no student twice within any four consecutive cards', !clash, clash);
  r = await req('v', 'GET', '/success-stories');
  ok('the order is the same on a reload', [...((r.text.split('id="admit-stories"')[1] || '').split('id="visa-work-stories"')[0]).matchAll(/<span class="ss-who">([^<]*)<\/span>/g)].map(m => m[1]).join('|') === names.join('|'));
  const visible = ss.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  ok('no scores, grades or notes in the page', !/\b(CGPA|IELTS|GRE|TOEFL|German grade|backlog|surname)\b/i.test(grid + routesHtml));
  ok('no filters, no search box, no stats strip', !/<(select|input)\b/.test(grid + routesHtml) && !/class="stat/.test(visible.split('</header>')[1] || visible));
  const shown = new Set(names);
  ok('every display name is the file\'s, as written (no surname added)', [...shown].every(n => data.admits.some(a => a['Display name'] === n)));
  ok('no counts in the page body', !/\b109 admission offers\b/.test((visible.split('<h1')[1] || '')));
  /* JSON-LD */
  const lds = [...ss.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch (e) { return { bad: true }; } });
  ok('every JSON-LD block parses', lds.length >= 3 && lds.every(x => !x.bad), lds.length);
  const crumbs = lds.find(x => x['@type'] === 'BreadcrumbList');
  ok('BreadcrumbList Home → Success stories', crumbs && crumbs.itemListElement.length === 2 && crumbs.itemListElement[1].name === 'Success stories');
  const lists = lds.filter(x => x['@type'] === 'ItemList');
  ok('two ItemLists: 109 offers and 13 routes', lists.length === 2 && lists[0].itemListElement.length === 109 && lists[1].itemListElement.length === 13,
    lists.map(l => l.itemListElement.length));
  ok('an offer reads "<name> — <university>, <programme> (<intake>)"', lists[0] && / — .+, .+ \((Winter|Summer) \d{4}\)$/.test(lists[0].itemListElement[0].name), lists[0] && lists[0].itemListElement[0].name);
  /* Logos */
  const imgs = [...new Set([...grid.matchAll(/<img src="([^"]+)" alt="([^"]+) logo"/g)].map(m => m[1].replace(/&amp;/g, '&')))];
  const inits = (grid.match(/class="ss-ini"/g) || []).length;
  const noLogo = ['Durham University', 'University of Surrey', 'Wrexham University', 'ISTEC Paris', 'Federation University Australia'];
  ok('initials tile for the five without a logo, logos for the rest',
    inits === data.admits.filter(a => noLogo.includes(a.University)).length, inits);
  let broken = [];
  for (const src of imgs) {
    const u = src.startsWith('http') ? src : BASE + (src.startsWith('/') ? '' : '/') + src;
    const x = await fetch(u);
    if (!x.ok || !/^image\//.test(x.headers.get('content-type') || '')) broken.push(src + ' ' + x.status);
  }
  ok('every logo loads (' + imgs.length + ' files)', imgs.length >= 40 && !broken.length, broken);
  ok('every logo is lazy, alt "<University> logo"', (grid.match(/<img /g) || []).length === (grid.match(/loading="lazy"/g) || []).length);
  ok('route cards link to the service pages', /href="\/work-opportunity-card\.html"/.test(routesHtml) && /href="\/visa-processing\.html"/.test(routesHtml) && /href="\/language-german\.html"/.test(routesHtml));
  for (const p of ['/work-opportunity-card.html', '/visa-processing.html', '/language-german.html']) {
    r = await req('v', 'GET', p);
    ok(p + ' links back to #visa-work-stories', /success-stories#visa-work-stories/.test(r.text));
  }
  /* Home */
  r = await req('v', 'GET', '/');
  const home = (r.text.split('id="stories"')[1] || '').split('</section>')[0];
  const homeNames = [...home.matchAll(/<span class="ss-who">([^<]*)<\/span>/g)].map(m => m[1]);
  ok('home "Real journeys" shows the page\'s first cards, server-rendered', homeNames.length === 8 && homeNames.join('|') === names.slice(0, 8).join('|'), homeNames);
  ok('home rail: the old surname testimonials are gone', !/Shaik Firoz|Venkat Deepak Tanuri|Keerthi S</.test(home));
  ok('home link: /success-stories, no count', /href="\/success-stories">See all success stories</.test(home) && !/data-count/.test(home));
  ok('home link: the visa stories too', /href="\/success-stories#visa-work-stories"/.test(home));

  done();
})().catch(e => { console.error(e); fail++; done(); });
