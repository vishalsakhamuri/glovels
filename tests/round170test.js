/*
 * Round 170 — two decisions from the owner, 12 Oct.
 *
 *  A. "Any restriction should be for ranking the unis." The "Restrictions: …"
 *     line is off every public programme card (home results, Find University,
 *     university pages). The counsellor's fit panel keeps it, and a restricted
 *     row is still treated by the ranking exactly as before.
 *
 *  B. "For German universities it's a package for students." A German PUBLIC
 *     university's page withholds its programme names, fees and deadlines
 *     (server-side), with an Unlock button per row and one line saying why.
 *     Private German universities and every other country are unchanged. A
 *     signed-in student whose package reveals that university — the same
 *     walk /api/catalogue does — sees the full list; so do staff.
 *
 *   ./tests/srv.sh 8105 ALLOW_INDEXING=true GLOVELS_URL=https://glovels.example
 *   BASE=http://localhost:8105 node tests/round170test.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const M = require(path.join(ROOT, 'server', 'matches.js'));
const UNIS = require(path.join(ROOT, 'server', 'unis.js'));

const BASE = process.env.BASE || 'http://localhost:8105';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + String(e === undefined ? '' : e).slice(0, 300))); };
const J = x => JSON.stringify(x);

const jar = {}; let ipn = 1; const ips = {};
async function req(who, method, p, body) {
  ips[who] = ips[who] || ('10.170.' + (ipn++) + '.' + (1 + Math.floor(Math.random() * 250)));
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ips[who] };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).filter(c => !/=$/.test(c)).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: j || {}, text };
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const has = (html, s) => html.includes(s) || html.includes(esc(s));

(async () => {
  /* ------------------------------------------------------------- A */
  console.log('A. "Restrictions:" is for ranking, not for the public card');
  const homeHtml = (await req('v', 'GET', '/')).text;
  /* The results code is in the page's external script (externalizeScripts). */
  let home = homeHtml;
  for (const m of homeHtml.matchAll(/<script[^>]*src="(\/js\/[^"]+)"/g)) home += (await req('v', 'GET', m[1])).text;
  ok('home page: no "Restrictions:" line in the results code', /function rowHtml/.test(home) && !/Restrictions:/.test(home) && !/mrestr/.test(home));
  ok('  · the "Restricted admission" tag and filter are still there (they are the ranking\'s, not the line)', /Restricted admission/.test(home) && /id="fRestricted"/.test(home));
  const find = (await req('v', 'GET', '/find-university?country=DE')).text;
  const findJs = (await req('v', 'GET', '/js/find.js')).text + (await req('v', 'GET', '/js/find-page.js')).text;
  ok('Find University: no "Restrictions:" on a row (page and its scripts)', find.length > 1000 && !/Restrictions:/.test(find) && !/Restrictions:/.test(findJs));
  const fit = (await req('v', 'GET', '/fitpanel.js')).text;
  ok('the counsellor\'s fit panel still says "Restrictions:" with the reason', /Restrictions: /.test(fit) && /restricted admission \(ranked, limited places\)/.test(fit));

  const row = (id, o) => Object.assign({ id, program: 'Computer Science', university: 'U' + id, level: 'master', field: 'Computer Science & IT',
    country: 'DE', isPublic: true, totalInr: 0, intakes: [], reqs: {} }, o);
  const cat = [row('a-nc', { reqs: { restricted: true } }), row('b-open'), row('c-open')];
  const P = { g_country: 'Germany', g_level: "Master's", g_field: 'Computer Science', d_course: 'B.Tech CSE', d_cgpa: '8', d_max: '10', d_pass: '4', e_test: 'IELTS', e_score: '6.5' };
  const C = { DE: 'Germany', Germany: 'DE' };
  const openOnly = M.screen(cat, Object.assign({}, P, { g_restricted: 'no' }), C, {});
  /* Round 177 (28 Oct item 8): a stated requirement the student falls short
     of is a HARD miss — the row stays in the set but in the near tier, below
     every fit, with the reason first. "Open admission only" against a
     restricted row is such a miss. Still kept, never dropped. */
  const ranked = openOnly.fits.concat(openOnly.near || []);
  const ids = ranked.map(x => x.id);
  const nc = ranked.find(x => x.id === 'a-nc') || {};
  ok('a restricted row is ranked BELOW the open ones for an open-admission student (kept, not dropped)',
    ids.length === 3 && ids.indexOf('a-nc') === 2
      && ((nc.soft || []).length > 0 || (nc.hard || []).length > 0 || (nc.why || []).length > 0),
    J(ranked.map(x => [x.id, x.soft, x.hard])));
  ok('  · and is held for the counsellor (in words) before a package names it',
    /Restricted admission/.test(M.holdReasons(row('x', { reqs: { restricted: true } }), P).join()));
  ok('  · screen() still marks the row restricted for the staff screens', M.screen(cat, P, C, {}).fits.find(x => x.id === 'a-nc').restricted === true);

  /* ------------------------------------------------------------- B */
  console.log('B. German public university pages are part of the packages');
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.status === 200, r.status);
  /* A non-German public university, so "every other country: unchanged" is tested. */
  r = await req('a', 'PUT', '/api/staff/programme', { program: 'R170 Water Engineering MSc', university: 'R170 Warsaw Public University',
    city: 'Warsaw', country: 'PL', level: 'master', field: 'Engineering', isPublic: true, totalInr: 900000, active: true });
  ok('a Polish public programme is added', r.status === 200, r.status + ' ' + r.text.slice(0, 160));
  const all = ((await req('a', 'GET', '/api/staff/catalogue?per=1000')).body.programmes) || [];
  const byUni = {};
  all.forEach(p => { const s = UNIS.slugOf(p.university); (byUni[s] = byUni[s] || { slug: s, name: p.university, country: p.country, isPublic: !!p.isPublic, progs: [], fields: new Set() }).progs.push(p.program); byUni[s].fields.add(p.field || ''); });
  const unis = Object.values(byUni);
  const dePub = unis.filter(u => u.country === 'DE' && u.isPublic).sort((a, b) => b.progs.length - a.progs.length);
  const dePriv = unis.find(u => u.country === 'DE' && !u.isPublic);
  const plPub = unis.find(u => u.country === 'PL' && u.isPublic);
  ok('the seed has German public and private universities (' + dePub.length + ' public)', dePub.length > 3 && !!dePriv);
  /* A name that is part of a field label or of the university's own name
     ("Computer Science" inside "Computer Science & IT") is not a leak. */
  const leaks = (html, u) => u.progs.filter(n => {
    const allowed = [...u.fields].join(' | ') + ' | ' + u.name;
    return has(html, n) && !allowed.includes(n);
  });

  const target = dePub[0];
  const pageOf = async (who, slug) => (await req(who, 'GET', '/university/' + slug));
  const pub = await pageOf('v', target.slug);
  ok('GET /university/' + target.slug + ' answers 200', pub.status === 200, pub.status);
  ok('  · signed out: none of its ' + target.progs.length + ' programme names is in the HTML', leaks(pub.text, target).length === 0, J(leaks(pub.text, target)));
  /* Round 176 (owner, go-live): a locked page lists at most 12 rows and
     never says how many there are — the count was one of the facts that
     picked a public university out of a locked finder row. */
  const nLocked = Math.min(12, target.progs.length);
  ok('  · every listed row is locked, with Unlock to the packages — at most 12 of them (round 176)', (pub.text.match(/class="prog locked/g) || []).length === nLocked
    && (pub.text.match(/data-unlock>Unlock</g) || []).length === nLocked && /href="\/#packages" data-unlock/.test(pub.text),
    (pub.text.match(/class="prog locked/g) || []).length + ' locked of ' + target.progs.length);
  ok('  · and the line "Programme names at German public universities are part of our packages."', /Programme names at German public universities are part of our packages\./.test(pub.text));
  ok('  · the fields are said, the count is not', /We track programmes here/.test(pub.text) && !new RegExp('We track ' + target.progs.length + ' programme').test(pub.text)
    && !/\d[\d,]* programmes?\b/.test(pub.text.replace(/<script[\s\S]*?<\/script>/g, ''))
    && [...target.fields].filter(Boolean).every(f => has(pub.text, f)), (pub.text.replace(/<script[\s\S]*?<\/script>/g, '').match(/[^>]{0,40}\d[\d,]* programmes?\b/g) || []).join(' | '));
  ok('  · no programme id on an Apply button, no course link, no programme anchor', !/data-apply=/.test(pub.text) && !/Course page ↗/.test(pub.text) && !/data-prog=/.test(pub.text));
  ok('  · the university itself is there: its name in the <h1>, its city, its official site chip', has(pub.text.replace(/<\/?em>/g, ''), '<h1>' + esc(target.name) + '</h1>') /* 15 Oct banner: italic last word */ && /Public university/.test(pub.text));
  const title = (/<title>([^<]*)</.exec(pub.text) || [])[1] || '';
  const desc = (/<meta name="description" content="([^"]*)"/.exec(pub.text) || [])[1] || '';
  const ld = (pub.text.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).join('');
  ok('  · title, description and JSON-LD name no programme', leaks(title + ' ' + desc + ' ' + ld, target).length === 0 && !/Course/.test(ld), title + ' | ' + desc);
  ok('  · the page stays indexable', !/<meta name="robots" content="[^"]*noindex/.test(pub.text), (/<meta name="robots"[^>]*>/.exec(pub.text) || [''])[0]);
  const sm = (await req('v', 'GET', '/sitemap.xml')).text + (await req('v', 'GET', '/sitemap-universities-1.xml')).text;
  ok('  · and is in the sitemap as before', sm.includes('university/' + target.slug), sm.slice(0, 200));

  const priv = await pageOf('v', dePriv.slug);
  ok('a German PRIVATE university (' + dePriv.name + ') shows its programme names', priv.status === 200 && dePriv.progs.every(n => has(priv.text, n)) && !/class="prog locked/.test(priv.text));
  const pl = await pageOf('v', plPub.slug);
  ok('a Polish PUBLIC university shows its programme names (other countries unchanged)', pl.status === 200 && plPub.progs.every(n => has(pl.text, n)) && !/class="prog locked/.test(pl.text), pl.status);

  const staff = await pageOf('a', target.slug);
  ok('staff (admin) see the German public university\'s names', target.progs.every(n => has(staff.text, n)) && !/class="prog locked/.test(staff.text));

  /* The index and the country page show counts, never programme names. */
  const idx = (await req('v', 'GET', '/university')).text;
  const de = (await req('v', 'GET', '/study-in-germany')).text;
  const idxLeaks = dePub.flatMap(u => leaks(idx + de, u));
  ok('the university index and the Germany page name no German public programme', idxLeaks.length === 0, J(idxLeaks.slice(0, 5)));
  /* The search box on the index: a German public programme is not found by name. */
  const word = (target.progs.find(n => /[A-Za-z]{6,}/.test(n)) || target.progs[0]).match(/[A-Za-z]{6,}/)[0];
  const s = (await req('v', 'GET', '/api/universities/search?q=' + encodeURIComponent(word))).body;
  const dePubSlugs = new Set(dePub.map(u => u.slug));
  ok('the name search answers no German public programme ("' + word + '")', Array.isArray(s.programmes) && s.programmes.every(p => !dePubSlugs.has(p.slug)), J((s.programmes || []).slice(0, 3)));

  /* A student whose package reveals public universities. */
  const st = Date.now().toString(36);
  r = await req('s', 'POST', '/api/orders', { name: 'Round Seventy', email: 'r170-' + st + '@ex.example', phone: '+919000170' + String(Date.now()).slice(-3), acceptedTerms: true, packageId: 'pkg-three-public' });
  ok('a student orders the three-public-universities package', r.status === 200, r.status + ' ' + r.text.slice(0, 160));
  const catS = (await req('s', 'GET', '/api/catalogue')).body;
  const namedSlugs = new Set((catS.programmes || []).filter(p => p.isPublic && p.university && p.country === 'DE').map(p => UNIS.slugOf(p.university)));
  ok('  · the finder names ' + namedSlugs.size + ' German public universities for them (the package\'s quota)', namedSlugs.size > 0 && namedSlugs.size <= 3, namedSlugs.size + ' / unlockedCount ' + catS.unlockedCount);
  const mineU = byUni[[...namedSlugs][0]];
  const mine = await pageOf('s', mineU.slug);
  ok('  · on a university the finder names for them, the page shows every programme name', mineU.progs.every(n => has(mine.text, n)) && !/class="prog locked/.test(mine.text) && /data-apply=/.test(mine.text));
  const notMine = dePub.find(u => !namedSlugs.has(u.slug));
  const nm = await pageOf('s', notMine.slug);
  ok('  · on one the finder still withholds, the page stays locked for them too', leaks(nm.text, notMine).length === 0 && /class="prog locked/.test(nm.text), notMine.slug);
  const back = await pageOf('v', mineU.slug);
  ok('  · and the same page signed out is locked again (nothing cached across visitors)', leaks(back.text, mineU).length === 0 && /class="prog locked/.test(back.text));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
