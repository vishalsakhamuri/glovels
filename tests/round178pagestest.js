/**
 * Round 178 (30 Oct, brief Part D) — "when a student searches for the
 * university or a search term in ChatGPT or Google, our site should come up."
 *
 *   - /university/<uni>/<programme> exists for every NAMED programme
 *     (private German universities, every other country) with Course +
 *     BreadcrumbList JSON-LD, and never shows a fee flagged indicative;
 *   - a German PUBLIC row has no page — the address built from its real name
 *     (read through a staff login, the oracle) is a 404 identical to an
 *     unknown one — and no new page prints its exact programme name;
 *   - no `N programmes` / `N universities` count on any new page;
 *   - each Germany master's guide has a unique first paragraph, valid
 *     FAQPage JSON-LD, at least one university and a link into Find
 *     University; an empty guide is a 404 and absent from the sitemap;
 *   - the university page carries a FAQ with valid FAQPage JSON-LD and a
 *     field-level "Subjects you can study" line;
 *   - the sitemap lists the hub, the live guides and the programme pages.
 *
 * Port 8135 by default (BASE overrides). Start the server with the live
 * settings: ALLOW_INDEXING=true GLOVELS_URL=https://www.glovels.com. Runs a
 * first pass on the seeded catalogue, then loads the German sheets itself
 * and runs again.
 */
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8135';
const SCR = process.env.R165_SCRATCH || '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad';
const UNIS = require(path.join(__dirname, '..', 'server', 'unis.js'));
const T = require(path.join(__dirname, '..', 'server', 'tags.js'));
const G = require(path.join(__dirname, '..', 'server', 'guides.js'));

let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + String(e === undefined ? '' : e).slice(0, 400))); };
const note = t => console.log('    · ' + t);
const done = () => { console.log('\nround178pagestest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); };

const jars = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.178.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] };
  if (jars[who]) h.cookie = jars[who];
  const once = () => fetch(BASE + p, { method, headers: h, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
  const r = await once().catch(() => once());
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jars[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; const text = await r.text();
  try { j = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, ok: r.ok, body: j, text, location: r.headers.get('location') };
}
const decode = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
/* What a person reads: no scripts, no styles, no tags. */
const visible = html => decode(String(html).replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const COUNT = /\d[\d,]* (programme|universit)/i;
const ldOf = html => [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch (e) { return { _bad: m[1].slice(0, 120) }; } });
const faqOk = l => l && l['@type'] === 'FAQPage' && Array.isArray(l.mainEntity) && l.mainEntity.length >= 3
  && l.mainEntity.every(q => q['@type'] === 'Question' && q.name && q.acceptedAnswer && q.acceptedAnswer['@type'] === 'Answer' && String(q.acceptedAnswer.text || '').length > 20);
const firstAnswer = html => { const m = /<p class="g-answer">([\s\S]*?)<\/p>/.exec(html); return m ? decode(m[1].replace(/<[^>]+>/g, '')).trim() : ''; };

const LANDINGS = ['masters-in-germany-without-ielts', 'germany-3-year-bachelor-accepted', 'tuition-free-masters-germany',
  'low-cgpa-masters-germany', 'english-taught-masters-germany-no-german']
  .concat(G.MONTHS.map(m => 'germany-masters-deadlines/' + m.toLowerCase()))
  .concat(G.BRANCHES.map(b => 'masters-in-germany-for/' + b.slug));

async function staffRows() {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const r = (await req('staff', 'GET', '/api/staff/catalogue?per=2000&status=&page=' + page)).body || {};
    const rows = r.programmes || [];
    out.push(...rows);
    if (!rows.length || out.length >= Number(r.total || 0)) break;
  }
  return out;
}

let thinSeen = 0;
async function guarantees(label) {
  console.log('\n— ' + label);
  const rows = await staffRows();
  ok('the staff catalogue (the oracle) reads every row', rows.length > 0, rows.length);
  const hidden = rows.filter(p => p.isPublic && String(p.country).toUpperCase() === 'DE');
  const named = rows.filter(p => !(p.isPublic && String(p.country).toUpperCase() === 'DE'));
  const fold = T.fold;
  const namedTitles = new Set(named.map(p => fold(UNIS.spaceDegree(p.program))));
  /* The same title without its degree words or a bracketed abbreviation:
     "Data Science, M.Sc." and "Data Science MSc" are one name. */
  const core = t => (' ' + fold(UNIS.spaceDegree(String(t || '')).replace(/\([^)]*\)/g, ' ')) + ' ')
    .replace(/ (m sc|msc|m a|ma|m eng|meng|mba|ll m|llm|m ed|med|mfa|mph|ms|master|masters|master of science|master of arts|of science|of arts|professional master) (?=.)/g, ' ')
    .replace(/ (m sc|msc|m a|ma|m eng|meng|mba|ll m|llm|ms|master) $/, ' ').trim();
  const namedText = ' ' + [...namedTitles].join(' | ') + ' | ' + named.map(p => core(p.program)).join(' | ') + ' ';
  const fieldText = ' ' + [...new Set(rows.map(p => fold(p.field)))].join(' | ') + ' ';
  const uniText = ' ' + [...new Set(rows.map(p => fold(p.university)))].join(' | ') + ' ';
  /* A hidden title is a leak when it shows up whole — unless it is also a
     named row's title, a subject many programmes share, or sits inside a
     field or university name (the page prints those on purpose). */
  const coreOf = new Map(hidden.map(p => [fold(UNIS.spaceDegree(p.program)), core(p.program)]));
  const leakable = [...coreOf.keys()].filter(k => {
    if (!k || k.length < 10 || namedTitles.has(k)) return false;
    const e = T.lookup(k);
    if (e && (e.type === 'Bachelor' || e.count >= 10)) return false;
    const c = coreOf.get(k), ec = T.lookup(c);
    if (!c || (ec && (ec.type === 'Bachelor' || ec.count >= 10)) || namedText.includes(' ' + c + ' ')) return false;
    /* inside a NAMED programme's title (a private "Global Logistics
       Management" carries "Global Logistics") it is that programme's name. */
    return !fieldText.includes(k) && !uniText.includes(k) && !namedText.includes(' ' + k + ' ');
  });
  note(hidden.length + ' hidden rows (' + leakable.length + ' distinctive titles to look for), ' + named.length + ' named');
  const leaksIn = html => { const v = ' ' + fold(visible(html)) + ' '; return leakable.filter(k => v.includes(' ' + k + ' ')); };
  const lockedSlugs = new Set(hidden.map(p => UNIS.slugOf(p.university)));

  /* ----------------------------------------------------------- sitemap */
  const sm = (await req('guest', 'GET', '/sitemap.xml')).text;
  const locs = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => decode(m[1])));
  const site = [...locs][0] ? [...locs][0].replace(/^(https?:\/\/[^/]+).*$/, '$1') : '';
  ok('the sitemap is served', locs.size > 0, sm.slice(0, 120));

  /* ------------------------------------------------------ guide pages */
  const intros = new Map();
  let live = 0;
  for (const p of LANDINGS) {
    const r = await req('guest', 'GET', '/' + p);
    const inMap = locs.has(site + '/' + p);
    if (r.status === 404) {
      thinSeen++;
      ok('  /' + p + ' is empty here: 404 and not in the sitemap', !inMap, 'listed in the sitemap');
      continue;
    }
    live++;
    const html = r.text;
    const bad = [];
    const intro = firstAnswer(html);
    if (r.status !== 200) bad.push('status ' + r.status);
    if (intro.length < 80) bad.push('no direct-answer first paragraph');
    if (intros.has(intro)) bad.push('intro same as /' + intros.get(intro));
    intros.set(intro, p);
    const lds = ldOf(html);
    if (!lds.some(faqOk)) bad.push('no valid FAQPage JSON-LD ' + JSON.stringify(lds.map(l => l['@type'] || l._bad)));
    if (!lds.some(l => l['@type'] === 'BreadcrumbList')) bad.push('no BreadcrumbList');
    if (lds.some(l => l._bad)) bad.push('unparseable JSON-LD');
    if (!/<ul class="g-unis"><li>/.test(html)) bad.push('no university listed');
    if (!/href="\/find-university\?[^"]*country=DE/.test(html)) bad.push('no link into Find University');
    if (!/href="\/#counsel"/.test(html)) bad.push('no free-counselling link');
    if (!html.includes('<link rel="canonical" href="' + site + '/' + p + '"')) bad.push('canonical not on the site address');
    const v = visible(html);
    if (COUNT.test(v)) bad.push('a count: ' + (v.match(new RegExp('.{0,40}' + COUNT.source + '.{0,20}', 'i')) || [''])[0]);
    const lk = leaksIn(html); if (lk.length) bad.push('hidden programme names: ' + lk.slice(0, 3).join(' | '));
    const progLinks = [...html.matchAll(/href="\/university\/([a-z0-9-]+)\/([a-z0-9-]+)"/g)];
    const toLocked = progLinks.filter(m => lockedSlugs.has(m[1]) && !named.some(n => UNIS.slugOf(n.university) === m[1]));
    if (toLocked.length) bad.push('programme link under a German public university: ' + toLocked[0][0]);
    if (!inMap) bad.push('not in the sitemap');
    ok('  /' + p + ': answer first, FAQ JSON-LD, universities, Find University link, canonical, no counts, no hidden names, in the sitemap', !bad.length, bad.join('; '));
  }
  if (rows.length > 2000) ok('the five requirement guides are live', ['masters-in-germany-without-ielts', 'germany-3-year-bachelor-accepted', 'tuition-free-masters-germany',
    'low-cgpa-masters-germany', 'english-taught-masters-germany-no-german'].every(p => locs.has(site + '/' + p)), [...locs].filter(l => /germany/.test(l)).slice(0, 8).join(' '));
  const hub = await req('guest', 'GET', '/germany-masters-guides');
  ok('the hub links every live guide and is in the sitemap', hub.status === 200 && LANDINGS.filter(p => locs.has(site + '/' + p)).every(p => hub.text.includes('href="/' + p + '"'))
    && locs.has(site + '/germany-masters-guides') && !COUNT.test(visible(hub.text)) && !leaksIn(hub.text).length, hub.status);
  const llms = (await req('guest', 'GET', '/llms.txt')).text;
  ok('/llms.txt lists the hub and every live guide', llms.includes(site + '/germany-masters-guides')
    && LANDINGS.filter(p => locs.has(site + '/' + p)).every(p => llms.includes(site + '/' + p + ')')), llms.slice(0, 120));
  const sid = await req('guest', 'GET', '/study-in-germany');
  ok('/study-in-germany and the footer link the hub', /href="\/germany-masters-guides"/.test(sid.text)
    && /<a href="\/germany-masters-guides">Germany master's guides<\/a><\/div>/.test((await req('guest', 'GET', '/about-us')).text));
  const bogus = await req('guest', 'GET', '/masters-in-germany-for/astrology');
  ok('an unknown branch or month is a 404', bogus.status === 404 && (await req('guest', 'GET', '/germany-masters-deadlines/smarch')).status === 404, bogus.status);

  /* ---------------------------------------------------- programme pages */
  const byUni = new Map();
  named.filter(p => p.active !== false).forEach(p => { const s = UNIS.slugOf(p.university); if (!byUni.has(s)) byUni.set(s, []); byUni.get(s).push(p); });
  const uniSample = [...byUni.keys()].filter(s => !lockedSlugs.has(s)).sort().filter((s, i, a) => i % Math.max(1, Math.floor(a.length / 18)) === 0).slice(0, 20);
  let pages = 0; const progBad = [];
  for (const s of uniSample) {
    const up = await req('guest', 'GET', '/university/' + s);
    if (up.status !== 200) continue;
    const links = [...new Set([...up.text.matchAll(new RegExp('href="(/university/' + s + '/[a-z0-9-]+)"', 'g'))].map(m => m[1]))];
    const want = byUni.get(s).length;
    if (links.length < Math.min(want, 1)) progBad.push(s + ': no programme links on its page');
    /* The old #anchor is still on the card. */
    const p0 = byUni.get(s)[0];
    if (!up.text.includes('id="' + UNIS.slugOf(p0.program) + '"') && !up.text.includes('class="prog locked')) progBad.push(s + ': #anchor gone');
    for (const l of links.slice(0, 3)) {
      const r = await req('guest', 'GET', l);
      pages++;
      const lds = ldOf(r.text);
      const c = lds.find(x => x['@type'] === 'Course');
      if (r.status !== 200) { progBad.push(l + ' ' + r.status); continue; }
      if (!c || !c.provider || !c.provider.name || !c.name) progBad.push(l + ': no Course JSON-LD');
      if (!lds.some(x => x['@type'] === 'BreadcrumbList')) progBad.push(l + ': no breadcrumbs');
      if (!r.text.includes('<link rel="canonical" href="' + site + l + '"')) progBad.push(l + ': canonical');
      if (!/Check your fit — free counselling/.test(r.text)) progBad.push(l + ': no CTA');
      if (firstAnswer(r.text).length < 60) progBad.push(l + ': no answer paragraph');
      if (COUNT.test(visible(r.text))) progBad.push(l + ': a count');
      if (!locs.has(site + l)) progBad.push(l + ': not in the sitemap');
    }
  }
  ok('named programmes have pages with Course + breadcrumbs + canonical + CTA, linked from the university card, in the sitemap (' + pages + ' read)', pages > 0 && !progBad.length, progBad.slice(0, 4).join('; '));

  /* ------------------------------------------- German public: no pages */
  const lockedSample = [...lockedSlugs].sort().slice(0, 25);
  const nf = await req('guest', 'GET', '/university/no-such-university-xyz/m-sc-nothing-masters');
  let tried = 0; const lockBad = [];
  for (const s of lockedSample) {
    const up = await req('guest', 'GET', '/university/' + s);
    if (up.status !== 200) continue;
    if (new RegExp('href="/university/' + s + '/').test(up.text)) lockBad.push(s + ': programme link on its page');
    const lk = leaksIn(up.text); if (lk.length) lockBad.push(s + ': names ' + lk.slice(0, 2).join(' | '));
    if (!/Subjects you can study/.test(up.text) && hidden.some(p => UNIS.slugOf(p.university) === s && p.field && p.field !== 'Other')) lockBad.push(s + ': no subjects line');
    const faq = ldOf(up.text).find(x => x['@type'] === 'FAQPage');
    if (!faqOk(faq)) lockBad.push(s + ': FAQ JSON-LD');
    const faqHtml = (/<h2 id="faq">[\s\S]*?<\/div>/.exec(up.text) || [''])[0];
    if (!faqHtml || COUNT.test(visible(faqHtml)) || /\b\d+ of its\b/.test(visible(faqHtml))) lockBad.push(s + ': FAQ missing or counts');
    for (const p of hidden.filter(h => UNIS.slugOf(h.university) === s).slice(0, 3)) {
      for (const lv of ['masters', 'bachelors', 'mba', 'phd']) {
        const guess = '/university/' + s + '/' + UNIS.slugOf(UNIS.spaceDegree(p.program)) + '-' + lv;
        const r = await req('guest', 'GET', guess);
        tried++;
        if (r.status !== 404 || r.text.length !== nf.text.length) lockBad.push(guess + ' → ' + r.status);
        if (locs.has(site + guess)) lockBad.push(guess + ' in the sitemap');
      }
    }
  }
  ok('German public universities: no programme page (' + tried + ' addresses built from the real names all 404 like an unknown one), FAQ + subjects, no names, no counts', tried > 0 && !lockBad.length, lockBad.slice(0, 4).join('; '));
  ok('no programme URL under a German public university in the sitemap', ![...locs].some(l => { const m = /\/university\/([a-z0-9-]+)\/[a-z0-9-]+$/.exec(l); return m && lockedSlugs.has(m[1]) && !byUni.has(m[1]); }));

  /* ------------------------------------------ a private university's FAQ */
  const priv = [...byUni.keys()].find(s => !lockedSlugs.has(s) && byUni.get(s).some(p => String(p.country) === 'DE'));
  if (priv) {
    const up = await req('guest', 'GET', '/university/' + priv);
    const faq = ldOf(up.text).find(x => x['@type'] === 'FAQPage');
    const qs = faq && faq.mainEntity ? faq.mainEntity.map(q => q.name).join(' | ') : '';
    ok('a private university page: FAQPage JSON-LD on IELTS, tuition, intakes, 3-year bachelor\'s and CGPA', faqOk(faq) && /IELTS/.test(qs) && /tuition-free/.test(qs) && /intakes/.test(qs) && /3-year/.test(qs) && /CGPA/.test(qs), qs);
    const cu = ldOf(up.text).find(x => x['@type'] === 'CollegeOrUniversity');
    ok('  · and CollegeOrUniversity JSON-LD with its address', !!(cu && cu.name && cu.address && cu.address.addressCountry), JSON.stringify(cu || {}).slice(0, 160));
  }
  return { rows, named, hidden, byUni, lockedSlugs, live };
}

(async () => {
  const login = await req('staff', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('staff can sign in (the oracle for this test)', login.ok, login.status);
  const health = await req('guest', 'GET', '/robots.txt');
  ok('the server runs with the live settings (indexing on)', /Sitemap: https?:\/\//.test(health.text), health.text.slice(0, 80));

  await guarantees('the seeded catalogue');

  const total0 = Number(((await req('staff', 'GET', '/api/staff/catalogue?per=1&status=')).body || {}).total || 0);
  const sheets = [SCR + '/r165/live-DE-noid.xlsx', SCR + '/out/glovels-germany-v37-new-rows.xlsx'].filter(f => fs.existsSync(f));
  let state = null;
  if (total0 < 1000 && sheets.length) {
    for (const f of sheets) {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
      const u = await fetch(BASE + '/api/staff/catalogue/import', { method: 'POST', headers: { cookie: jars.staff, 'x-forwarded-for': ips.staff }, body: fd });
      note('loaded ' + path.basename(f) + ': ' + u.status + ' ' + (await u.text()).slice(0, 100));
    }
    const big = (await req('staff', 'GET', '/api/staff/catalogue?per=1&status=')).body || {};
    ok('the German sheets are loaded (over 2,000 rows)', Number(big.total) > 2000, big.total);
    state = await guarantees('the German catalogue');
  } else {
    note(sheets.length ? 'catalogue already large — one pass' : 'German sheets not on disk — the big-catalogue pass is skipped');
    state = await guarantees('the catalogue as loaded');
  }
  ok('the thin-page guard was exercised (some guide was empty on one of the catalogues)', thinSeen > 0, thinSeen);

  /* ------------------------------------- an indicative fee stays hidden */
  const target = state.named.find(p => String(p.country) === 'DE' && p.active !== false && !p.searchOnly) || state.named[0];
  if (target) {
    const fee = 4321987;   // ₹43.2 lakh — a figure nothing else on the site carries
    const body = Object.assign({}, target, { totalInr: fee, feeIndicative: true, awardingBody: 'University of Testshire',
      reqs: Object.assign({}, target.reqs || {}, { tuitionEurSem: 7654 }) });
    const put = await req('staff', 'PUT', '/api/staff/programme', body);
    ok('staff flag a programme\'s fee as indicative (and give it an awarding body)', put.ok, put.status + ' ' + put.text.slice(0, 160));
    const s = UNIS.slugOf(target.university);
    const up = await req('guest', 'GET', '/university/' + s);
    const link = (up.text.match(new RegExp('href="(/university/' + s + '/[a-z0-9-]+)"[^>]*>' + target.program.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;') + '<')) || [])[1];
    ok('  · its card links to its page', !!link, s);
    if (link) {
      const r = await req('guest', 'GET', link);
      const c = ldOf(r.text).find(x => x['@type'] === 'Course') || {};
      const v = visible(r.text);
      ok('  · the programme page says "Fee on request", no figure, and Course has no offers', r.status === 200 && /Fee on request/.test(v)
        && !v.includes(UNIS.money(fee)) && !/7,?654/.test(v) && !c.offers && !JSON.stringify(c).includes(String(fee)), r.status + ' ' + JSON.stringify(c.offers || null));
      ok('  · the awarding body is shown and in the Course record', /University of Testshire/.test(v) && /University of Testshire/.test(JSON.stringify(c)), v.slice(0, 200));
    }
    ok('  · the university page and its FAQ do not print it either', !visible(up.text).includes(UNIS.money(fee)) && !/7,?654/.test(visible(up.text)));
    for (const p of LANDINGS.slice(0, 5)) {
      const r = await req('guest', 'GET', '/' + p);
      if (r.status === 200 && visible(r.text).includes(UNIS.money(fee))) ok('  · /' + p + ' prints the indicative fee', false);
    }
  }
  done();
})().catch(e => { console.error(e); fail++; done(); });
