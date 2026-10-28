/*
 * 10 Oct — the tag search.
 *
 * "A field where a student or counsellor can give free text, and using tags
 *  we show the relevant universities; suggestions for student and counsellor
 *  should come from these tags so correct search results are possible."
 *
 * Node-only checks on server/tags.js (derive, suggest, match), then, with a
 * server on 8099: /api/tags suggestions, locked rows carrying no name-giving
 * tag, the tags column round-tripping through the staff sheet, and the three
 * screens in a browser — the home box's suggestions and chips, /find-university
 * reading ?tags=, the counsellor's add-a-university search.
 * Run: node tests/tagtest.js  (the browser part needs playwright)
 */
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'server', 'tags.js'));
const F = require(path.join(__dirname, '..', 'server', 'find.js'));
const M = require(path.join(__dirname, '..', 'server', 'matches.js'));

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); } };

/* ------------------------------------------------------------- node only */
check('the dictionary loads', T.loaded() && T.dictionary().length > 3000, T.dictionary().length);
check('a value is looked up without accents or case', T.lookup('tu munich') && T.lookup('TÜBINGEN') && T.lookup('tuebingen'));
check('types come from the dictionary', T.typeOf('TU Munich') === 'University' && T.typeOf('No German Required') === 'Language' && T.typeOf('München') === 'City');

const row = { id: 'x1', program: 'MSc Data Science and Artificial Intelligence', university: 'Technical University of Munich', shortName: 'TU Munich', city: 'München',
  country: 'DE', level: 'master', field: 'Data Science, AI & Machine Learning', isPublic: true, totalInr: 0,
  intakes: [{ season: 'winter', deadline: '2026-07-15' }, { season: 'summer', deadline: '2026-01-15' }],
  reqs: { moiAccepted: true, greRequired: true, bachelorYears: 3, germanLevel: '', bachelorSubjects: 'Computer Science, IT or closely related', workExpRequired: true } };
const d = T.derive(row);
const has = (list, v) => list.some(t => t.toLowerCase() === v.toLowerCase());
check('derive: degree from the title', has(d, 'MSc'));
check('derive: public, no tuition', has(d, 'Public University') && has(d, 'No Tuition Fee'));
check('derive: MOI, GRE, work experience', has(d, 'MOI Accepted') && has(d, 'GRE') && has(d, 'Work Experience'));
check('derive: 3-year bachelor from bachelorYears', has(d, '3-Year Bachelor Accepted'));
check('derive: no German when the level is blank', has(d, 'No German Required'));
check('derive: intake seasons and deadline months', has(d, 'Winter') && has(d, 'Summer') && has(d, 'Winter Deadline July') && has(d, 'Summer Deadline January'));
check('derive: university, short name, city', has(d, 'Technical University of Munich') && has(d, 'TU Munich') && has(d, 'München'));
check('derive: title words and dictionary phrases', has(d, 'Data') && has(d, 'Data Science') && has(d, 'Artificial Intelligence'));
check('derive: bachelor subjects it asks for', has(d, 'Computer Science') && has(d, 'IT'));
check('derive: German level when stated', has(T.derive({ program: 'x', reqs: { germanLevel: 'B2' } }), 'German B2'));
check('derive: private, GRE optional, tuition 0 from reqs', (() => { const t = T.derive({ program: 'MBA', university: 'Biz', isPublic: false, totalInr: 100, reqs: { greRequired: false, greMin: 300, tuitionEurSem: 0 } }); return has(t, 'Private University') && has(t, 'GRE Recommended / Optional') && has(t, 'No Tuition Fee') && has(t, 'MBA'); })());
check('tagsOf: stored tags win', T.tagsOf({ program: 'x', tags: ['A', 'B'] }).join() === 'A,B' && T.tagsOf({ program: 'x', tags: 'A;B' }).join() === 'A,B');
check('tagsOf: derived when none stored', T.tagsOf({ program: 'MSc Physics', tags: [] }).length > 0);
const pub = T.publicTags(row);
check('publicTags drops university, short name, city and the title', !has(pub, 'TU Munich') && !has(pub, 'Technical University of Munich') && !has(pub, 'München') && !has(pub, row.program));
check('publicTags keeps the rest', has(pub, 'No German Required') && has(pub, 'Data Science'));

let s = T.suggest('data');
check('suggest: Data Science and Data lead for "data"', s.length > 2 && s.slice(0, 2).map(x => x.value).join() === 'Data Science,Data', s.slice(0, 3).map(x => x.value).join());
check('suggest: a prefix outranks a substring', T.suggest('munich')[0].value === 'TU Munich' || T.suggest('munich').findIndex(x => x.value === 'TU Munich') >= 0);
check('suggest: "no german" finds the language tag', T.suggest('no german')[0].value === 'No German Required');
check('suggest: types narrow', T.suggest('data', { types: ['Bachelor'] }).every(x => x.type === 'Bachelor'));
check('suggest: per-type cap', T.suggest('a', { perType: 2 }).filter(x => x.type === 'Programme').length <= 2);
check('suggest: German spelling of a short name', T.suggest('muenchen').some(x => x.value === 'München'));
check('group: by type in order', T.group(T.suggest('data')).map(g => g.type).join() === 'Programme,Bachelor');

check('match: every chosen tag has to hold', T.match(row, ['TU Munich', 'No German Required'], '') && !T.match(row, ['TU Munich', 'GMAT'], ''));
check('match: case does not matter', T.match(row, ['tu munich'], ''));
check('match: free text hits a tag or the names', T.match(row, [], 'munich') && T.match(row, [], 'moi') && !T.match(row, [], 'berlin'));
check('match: a phrase chip hits the title even when not a stored tag', T.match({ program: 'MSc Data Science and AI', tags: ['Public University'] }, ['Data Science'], ''));
check('match: nothing chosen keeps everything', T.match({ program: 'x' }, [], '') && T.match({ program: 'x' }, '', ''));
check('score: more hits, higher', T.score(row, ['TU Munich', 'GRE'], 'data') > T.score(row, ['TU Munich'], '') && T.score(row, ['GMAT'], '') === 0);
check('parseList trims, dedupes, caps', T.parseList(' A ; b;a;;').join() === 'A,b' && T.parseList(Array.from({ length: 80 }, (_, i) => 't' + i)).length === 60);

/* find.js reads the same module */
const f = F.parse('?tags=No%20German%20Required;TU%20Munich;;tu munich&q=data');
check('find: parse tidies the tag list', f.tags === 'No German Required;TU Munich' && f.q === 'data');
check('find: keep() uses the tags', F.keep(row, f) && !F.keep({ program: 'MSc Physics', university: 'TU Berlin', reqs: {} }, f));
check('find: toQuery carries tags and q', F.toQuery({ tags: 'A;B', q: 'x' }) === '?tags=A%3BB&q=x');

/* matches.js screen() takes opts.tags */
const cat = [row, { id: 'x2', program: 'MSc Physics', university: 'TU Berlin', city: 'Berlin', country: 'DE', level: 'master', field: 'Natural Sciences (Physics, Chemistry, Maths)', isPublic: true, totalInr: 0, intakes: [], reqs: {} }];
const sc = M.screen(cat, { g_country: 'Germany', d_cgpa: '8', d_max: '10' }, { DE: { code: 'DE', name: 'Germany' } }, { tags: 'TU Munich' });
check('screen: tags narrow the rows', sc.counts.looked === 1 && (sc.fits[0] || sc.near[0]).id === 'x1', JSON.stringify(sc.counts));
check('screen: rows carry their first tags', Array.isArray((sc.fits[0] || sc.near[0]).tags) && (sc.fits[0] || sc.near[0]).tags.length <= 6 && (sc.fits[0] || sc.near[0]).tags.length > 0);

/* ----------------------------------------------------------- with a server */
const BASE = process.env.BASE || 'http://localhost:8099';
let chromium = null;
try { chromium = require('playwright').chromium; } catch (e) { /* node-only run */ }

(async () => {
  let up = false;
  try { up = (await fetch(BASE + '/api/health')).ok; } catch (e) { up = false; }
  if (!up) { console.log('  (no server on ' + BASE + ' — server and browser checks skipped)'); return done(); }

  const j = async (u, o) => { const r = await fetch(BASE + u, o); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  let r = await j('/api/tags?q=data');
  check('/api/tags: "data" suggests Data Science first', r.status === 200 && r.body.suggestions[0].value === 'Data Science' && r.body.suggestions[0].type === 'Bachelor', JSON.stringify(r.body.suggestions.slice(0, 2)));
  r = await j('/api/tags?q=tu%20munich');
  /* Round 169 (CNS-04): a university's names are merged — the suggestion is the
     full name and carries "TU Munich" as an alias. */
  check('/api/tags: "tu munich" is the university', r.body.suggestions.length === 1 && r.body.suggestions[0].type === 'University'
    && (r.body.suggestions[0].value === 'TU Munich' || (r.body.suggestions[0].aliases || []).includes('TU Munich')), JSON.stringify(r.body.suggestions));
  r = await j('/api/tags?q=no%20german');
  check('/api/tags: "no german" is the language tag', r.body.suggestions[0].value === 'No German Required');
  r = await j('/api/tags?q=x');
  check('/api/tags: one letter answers nothing', r.body.suggestions.length === 0);
  r = await j('/api/tags?q=it%20security');
  check('/api/tags: falls back to programme names when the dictionary has none', r.body.suggestions.some(x => x.type === 'Programme' && /it security/i.test(x.value)), JSON.stringify(r.body.suggestions.slice(0, 2)));

  r = await j('/api/catalogue');
  const rows = r.body.programmes || [];
  check('/api/catalogue: every row carries tags', rows.length > 0 && rows.every(p => Array.isArray(p.tags) && p.tags.length > 0));
  const locked = rows.filter(p => p.isPublic && !p.university);
  const idTypes = ['University', 'City', 'State'];
  check('/api/catalogue: locked rows carry no University/City/State tag', locked.length > 0 && locked.every(p => p.tags.every(t => !idTypes.includes(T.typeOf(t)))), locked.length + ' locked');
  const named = rows.find(p => p.university);
  check('/api/catalogue: a named row carries its university tag', !!named && named.tags.some(t => t === named.university || t === named.shortName));

  /* The sheet round-trip: download, set a tags cell, upload, download. */
  const admin = { headers: {} };
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  admin.headers.Cookie = cookie;
  const parseCsv = text => {
    const out = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); out.push(row); }
    return out.filter(x => x.length > 1);
  };
  const quote = v => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const csv = await (await fetch(BASE + '/api/staff/catalogue.csv', admin)).text();
  const grid = parseCsv(csv.replace(/^﻿/, ''));
  const head = grid[0], body = grid.slice(1);
  const iTags = head.indexOf('tags'), iId = head.indexOf('id'), iPub = head.indexOf('public university');
  check('the sheet has a tags column', iTags >= 0, head.join('|').slice(0, 200));
  const target = body.find(x => x[iPub] === 'no');
  const sheet = mut => [head].concat(body.map(x => { const c = x.slice(); mut(c); return c; })).map(x => x.map(quote).join(',')).join('\n');
  const upload = async (text, confirm) => {
    const fd = new FormData();
    fd.append('file', new Blob([text], { type: 'text/csv' }), 'catalogue.csv');
    if (confirm) fd.append('confirm', 'yes');
    return j('/api/staff/catalogue/import', { method: 'POST', headers: { Cookie: cookie }, body: fd });
  };
  const tagged = sheet(c => { if (c[iId] === target[iId]) c[iTags] = 'No German Required;MOI Accepted;Test Tag'; });
  let plan = (await upload(tagged, false)).body; plan = plan.plan || plan;
  check('import: a filled tags cell is one change', (plan.update || []).length === 1 && (plan.unknownColumns || []).length === 0, JSON.stringify({ u: (plan.update || []).length, unk: plan.unknownColumns }));
  const applied = (await upload(tagged, true)).body;
  check('import: applying writes one row', applied.updated === 1, JSON.stringify(applied));
  let after = parseCsv((await (await fetch(BASE + '/api/staff/catalogue.csv', admin)).text()).replace(/^﻿/, ''));
  let back = after.slice(1).find(x => x[iId] === target[iId]);
  check('export: the tags come back as written', back && back[iTags] === 'No German Required;MOI Accepted;Test Tag', back && back[iTags]);
  /* A sheet with the column blank, and one without the column, both keep them. */
  const blank = sheet(c => { c[iTags] = ''; });
  plan = (await upload(blank, false)).body; plan = plan.plan || plan;
  check('import: a blank tags cell is not a change', (plan.update || []).length === 0, (plan.update || []).length + ' updates');
  const without = [head.filter((h, i) => i !== iTags)].concat(body.map(x => x.filter((v, i) => i !== iTags))).map(x => x.map(quote).join(',')).join('\n');
  plan = (await upload(without, false)).body; plan = plan.plan || plan;
  check('import: a sheet without the column changes nothing', (plan.update || []).length === 0 && (plan.rejected || []).length === 0, (plan.update || []).length + ' updates');
  await upload(without, true);
  after = parseCsv((await (await fetch(BASE + '/api/staff/catalogue.csv', admin)).text()).replace(/^﻿/, ''));
  back = after.slice(1).find(x => x[iId] === target[iId]);
  check('and the stored tags survive it', back && back[iTags] === 'No German Required;MOI Accepted;Test Tag', back && back[iTags]);
  /* The stored tags reach the finder's rows and the staff search. */
  r = await j('/api/catalogue');
  const tr = (r.body.programmes || []).find(p => String(p.id) === target[iId]);
  check('/api/catalogue: stored tags replace the derived ones', tr && tr.tags.join(';') === 'No German Required;MOI Accepted;Test Tag', tr && tr.tags.join(';'));
  r = await j('/api/staff/catalogue?q=test%20tag&status=', admin);
  check('the staff search box finds a stored tag through the index', r.body.total === 1 && String(r.body.programmes[0].id) === target[iId], r.body.total);
  r = await j('/api/staff/catalogue?tags=' + encodeURIComponent('Test Tag;MOI Accepted') + '&status=', admin);
  check('?tags= on the staff list narrows to rows carrying every tag', r.body.total === 1 && String(r.body.programmes[0].id) === target[iId], r.body.total);
  r = await j('/api/staff/catalogue?tags=' + encodeURIComponent('No German Required') + '&per=5&status=', admin);
  check('?tags= also matches derived tags', r.body.total > 1 && r.body.programmes[0].tagsShown.length > 0, r.body.total);
  r = await j('/api/staff/fit', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ profile: { d_cgpa: '8', d_max: '10' }, filters: { tags: 'Test Tag', limit: 10, kind: 'any' } }) });
  check('the matcher takes tags', r.status === 200 && r.body.counts.looked === 1 && (r.body.fits.concat(r.body.near)[0] || {}).id === target[iId], JSON.stringify(r.body.counts));
  const sr = await (await fetch(BASE + '/js/tags.js')).text();
  check('/js/tags.js is served', /root\.TAGS = factory/.test(sr));

  /* Patch 165: a TAGS-ONLY sheet — id + tags (+ names for the reader), no
     data columns — changes the tags and nothing else. */
  const other = body.find(x => x[iPub] === 'yes' && x[iId] !== target[iId]);
  const iFee = head.indexOf('total tuition inr'), iCg = head.indexOf('minimum cgpa');
  const tagsOnly = [['id', 'university', 'programme', 'tags'],
    [target[iId], 'x', 'y', 'Only Tag;No German Required'],
    [other[iId], '', '', ''],
    ['nope-404', '', '', 'A'],
  ].map(x => x.map(quote).join(',')).join('\n');
  plan = (await upload(tagsOnly, false)).body;
  check('tags-only sheet: previewed as one change, one unchanged, one refused', plan.tagsOnly === true && plan.counts.update === 1 && plan.counts.unchanged === 1 && plan.counts.rejected === 1, JSON.stringify(plan.counts));
  r = await upload(tagsOnly, true);
  check('tags-only sheet: refused rows block the apply until skipped', r.status === 422);
  const fd2 = new FormData(); fd2.append('file', new Blob([tagsOnly], { type: 'text/csv' }), 'tags.csv'); fd2.append('confirm', 'yes'); fd2.append('skipBad', 'yes');
  r = await j('/api/staff/catalogue/import', { method: 'POST', headers: { Cookie: cookie }, body: fd2 });
  check('tags-only sheet: applies one row', r.body.applied === true && r.body.updated === 1 && r.body.skipped === 1, JSON.stringify(r.body));
  after = parseCsv((await (await fetch(BASE + '/api/staff/catalogue.csv', admin)).text()).replace(/^﻿/, ''));
  back = after.slice(1).find(x => x[iId] === target[iId]);
  check('tags-only sheet: the tags changed', back && back[iTags] === 'Only Tag;No German Required', back && back[iTags]);
  check('tags-only sheet: the fee, CGPA and names did not', back && back[iFee] === target[iFee] && back[iCg] === target[iCg] && back[head.indexOf('university')] === target[head.indexOf('university')]);
  r = await j('/api/staff/catalogue?q=only%20tag&status=', admin);
  check('tags-only sheet: the index knows the new tag', r.body.total === 1 && String(r.body.programmes[0].id) === target[iId], r.body.total);

  if (!chromium) { console.log('  (no playwright — browser checks skipped)'); return done(); }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  /* ---- the home page */
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('home: the module is on the page', await page.evaluate(() => !!(window.TAGS && window.TAGS.match)));
  await page.fill('#fSearch', 'no german');
  await page.waitForSelector('#fSearchRes .fstag', { timeout: 5000 }).catch(() => {});
  const sug = await page.$$eval('#fSearchRes .fstag', b => b.map(x => x.dataset.tag + '/' + x.dataset.type));
  check('home: typing shows tag suggestions grouped by type', sug.includes('No German Required/Language') && (await page.$$('#fSearchRes h5')).length >= 1, sug.join());
  /* Round 176: the tabs carry no number any more (owner: numbers not
     required), so what is "shown" is the rows drawn on the open tab. */
  const shown = () => page.evaluate(() => document.querySelectorAll('#rowsIn .mrow').length);
  const totalBefore = await shown();
  check('home: the tabs carry no count (round 176)', (await page.textContent('#rtnPub')).trim() === '' && (await page.textContent('#rtnPriv')).trim() === '');
  await page.click('#fSearchRes .fstag');
  await page.waitForTimeout(600);
  check('home: a pick adds a chip under the box', (await page.$$eval('#fTagChips .ftagchip', b => b.map(x => x.textContent))).some(t => /No German Required/.test(t)));
  check('home: and clears the box', (await page.inputValue('#fSearch')) === '');
  check('home: the chip is in the criteria line', /No German Required/.test(await page.textContent('#rCrit')));
  await page.fill('#fSearch', 'tu munich');
  await page.waitForSelector('#fSearchRes .fstag', { timeout: 5000 }).catch(() => {});
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const chips = await page.$$eval('#fTagChips .ftagchip', b => b.map(x => x.textContent));
  check('home: Enter adds the first suggestion as a second chip', chips.length === 2 && chips.some(t => /TU Munich|Technical University of Munich/.test(t)), chips.join(' | '));
  const n = await shown();
  check('home: two chips narrow the list', n < totalBefore, n + ' of ' + totalBefore);
  const href = await page.getAttribute('#rFind', 'href');
  check('home: More universities carries tags=a;b', /tags=No(\+|%20)German(\+|%20)Required%3B(TU|Technical(\+|%20)University(\+|%20)of)(\+|%20)Munich/.test(href), href);
  await page.click('#fTagChips .ftagchip >> nth=1');
  await page.waitForTimeout(400);
  check('home: × removes a chip', (await page.$$('#fTagChips .ftagchip')).length === 1);
  await page.fill('#fSearch', 'zzqx');
  await page.waitForTimeout(700);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check('home: free text that matches no tag becomes a text chip', (await page.$$eval('#fTagChips .ftagchip', b => b.map(x => x.className))).some(c => /text/.test(c)));
  check('home: and the text chip searches the names (nothing has zzqx)', (await shown()) === 0);
  await page.click('#fTagChips .ftagchip.text');
  await page.fill('#fSearch', 'stuttgart');
  await page.waitForSelector('#fSearchRes a', { timeout: 5000 }).catch(() => {});
  check('home: university links still come with the suggestions', (await page.$$('#fSearchRes a')).length >= 1);
  await page.keyboard.press('Escape');
  check('home: Escape closes the box', await page.locator('#fSearchRes').isHidden());
  check('home: no page errors', errs.length === 0, errs.join(' | '));

  /* ---- Find University */
  await page.goto(BASE + '/find-university?tags=' + encodeURIComponent('No German Required;MBA') + '&country=DE', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const fchips = await page.$$eval('#fchips .ftagchip', b => b.map(x => x.dataset.cleartag));
  check('find: ?tags= shows one chip per tag', fchips.join() === 'No German Required,MBA', fchips.join());
  const ssr = await (await fetch(BASE + '/find-university?tags=' + encodeURIComponent('No German Required;MBA') + '&country=DE')).text();
  check('find: the server renders the chips and the rail group', /data-cleartag="MBA"/.test(ssr) && /id="ftagsRail"/.test(ssr) && /ftagrow/.test(ssr));
  /* Round 176: no data-total on the list and at most 12 locked rows on the
     page (owner: a visitor never learns the size of the hidden set). The
     narrowing is read from the rows: with the tags the page draws rows, no
     more locked ones than without them, and never more than the cap. */
  const ssrAll = await (await fetch(BASE + '/find-university?country=DE')).text();
  const lockedOf = h => (h.match(/class="frow locked"/g) || []).length, rowsOf = h => (h.match(/<article class="frow/g) || []).length;
  check('find: the tags narrow the server-rendered list (capped, no total)', rowsOf(ssr) > 0 && lockedOf(ssr) <= lockedOf(ssrAll) && lockedOf(ssr) <= 12 && !/data-total=/.test(ssr), rowsOf(ssr) + ' rows, ' + lockedOf(ssr) + ' locked of ' + lockedOf(ssrAll));
  check('find: the rail lists the chosen tags', (await page.$$eval('#ftagsRail .ftagrow', b => b.map(x => x.dataset.cleartag))).join() === 'No German Required,MBA');
  await page.fill('#fq', 'moi');
  await page.waitForSelector('#fsug button', { timeout: 5000 }).catch(() => {});
  check('find: the box suggests tags', (await page.$$('#fsug button')).length >= 1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  check('find: Enter on a suggestion adds a chip and writes the address', /MOI/.test(page.url()) && (await page.$$('#fchips .ftagchip')).length === 3, page.url());
  await page.click('#ftagsRail .ftagrow >> nth=0');
  await page.waitForTimeout(600);
  check('find: × in the rail removes the tag', !/No%20German|No\+German/.test(page.url()) && (await page.$$('#fchips .ftagchip')).length === 2, page.url());
  await page.fill('#fq', 'zzqx');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check('find: Enter with no suggestion searches the names', /q=zzqx/.test(page.url()) && (await page.$$('#flist .frow')).length === 0, page.url());
  check('find: no page errors', errs.length === 0, errs.join(' | '));

  /* ---- the counsellor's add-a-university search */
  await ctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  await page.goto(BASE + '/counsellor', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.locator('[data-open]').first().click();
  await page.waitForTimeout(2200);
  await page.click('.tab[data-t="file"]');
  await page.waitForTimeout(800);
  await page.click('#addUni');
  await page.waitForTimeout(400);
  await page.fill('#uniQ', 'no german');
  await page.waitForSelector('#uniSug button', { timeout: 5000 }).catch(() => {});
  check('counsellor: the box suggests tags', (await page.$$eval('#uniSug button', b => b.map(x => x.dataset.unisug))).includes('No German Required'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  check('counsellor: Enter adds a chip', (await page.$$eval('#uniTags [data-unitag]', b => b.map(x => x.textContent))).some(t => /No German Required/.test(t)));
  check('counsellor: and the list is narrowed by it', (await page.$$('#uniHits li')).length > 0, (await page.$$('#uniHits li')).length + ' hits');
  check('counsellor: hits show their tags', (await page.textContent('#uniHits')).includes('No German Required'));
  await page.fill('#uniQ', 'only tag');
  await page.waitForTimeout(1500);
  const hits = await page.$$eval('#uniHits li b', b => b.map(x => x.textContent));
  check('counsellor: typed words reach the stored tags through the index', hits.length === 1, hits.join());
  check('counsellor: no page errors', errs.length === 0, errs.join(' | '));

  /* ---- the matcher panel */
  await page.click('#fitUni');
  await page.waitForSelector('#gfTagQ', { timeout: 5000 }).catch(() => {});
  check('matcher: the panel has a tags box', await page.isVisible('#gfTagQ'));
  await page.waitForTimeout(2500);
  const fitsBefore = (await page.$$('#gfOut li')).length;
  await page.fill('#gfTagQ', 'winter');
  await page.waitForSelector('#gfTagSug button', { timeout: 5000 }).catch(() => {});
  check('matcher: the box suggests tags', (await page.$$eval('#gfTagSug button', b => b.map(x => x.dataset.gfsug))).includes('Winter'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  check('matcher: a chip is drawn', (await page.$$eval('#gfTagChips .gf-chip', b => b.map(x => x.textContent))).some(t => /Winter/.test(t)));
  const fitsAfter = (await page.$$('#gfOut li')).length;
  check('matcher: the search ran with the tag and still finds rows', fitsAfter > 0 && (fitsBefore === 0 || fitsAfter <= fitsBefore), fitsBefore + ' -> ' + fitsAfter);
  check('matcher: rows show tag pills', (await page.$$('#gfOut .tagpill')).length > 0);
  await page.fill('#gfTagQ', 'zzqx-nothing');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  check('matcher: a tag nothing carries empties the list', (await page.$$('#gfOut li')).length === 0);
  check('matcher: no page errors', errs.length === 0, errs.join(' | '));

  await browser.close();
  done();
})().catch(e => { console.log('  ✗ crashed: ' + (e && e.stack || e)); fail++; done(); });

function done() { console.log('tagtest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
