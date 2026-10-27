/**
 * Round 175 (item 1) — a locked row must not be re-identifiable.
 *
 * The tester, signed out: "/api/catalogue's locked rows carry the programme
 * name as their first tag, the exact length of the hidden programme and
 * university names (nLen / uLen), and a fixed uKey that groups them into
 * universities. /api/universities/search gives every public university's
 * name and programme count. Country + name length + programme count picks
 * out 127 of the 168 hidden universities. The grey bars are drawn at the
 * hidden length, and the search box matches hidden names ('script' finds
 * 'Manuscript Cultures')."
 *
 * This test runs the attack rather than reading the code: it reads the real
 * names through a staff login and checks that nothing a visitor gets can be
 * joined to them. Port 8118 by default (BASE overrides).
 */
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8118';
const F = require(path.join(__dirname, '..', 'server', 'find.js'));
const R = require(path.join(__dirname, '..', 'server', 'reqs.js'));
const T = require(path.join(__dirname, '..', 'server', 'tags.js'));

let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };

/* One cookie jar per person. */
const jars = {};
async function req(who, method, p, body) {
  const h = { 'content-type': 'application/json' };
  if (jars[who]) h.cookie = jars[who];
  /* One retry: a keep-alive socket the server closed while the previous
     (slow, full-catalogue) response was being read shows up as a failed
     fetch, not as an answer. */
  const once = () => fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const r = await once().catch(() => once());
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jars[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; const text = await r.text();
  try { j = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, ok: r.ok, body: j, text };
}
const fold = s => T.fold(s);
const isLocked = p => p && p.isPublic && !p.university;

(async () => {
  /* ------------------------------------------------ the real names, as staff */
  const login = await req('staff', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('staff can sign in (the oracle for this test)', login.ok, login.status);
  const staffCat = (await req('staff', 'GET', '/api/staff/catalogue?per=5000')).body || {};
  const real = (staffCat.programmes || []).filter(p => p.isPublic || p.is_public);
  ok('the staff catalogue names the public programmes', real.length > 0, real.length);
  const titles = real.map(p => fold(p.program)).filter(Boolean);
  const bareTitles = titles.map(t => t.replace(/^(m ?sc|b ?sc|m ?a|b ?a|m ?eng|mba|ll ?m)\s+/, ''));
  const uniNames = new Set(real.flatMap(p => [p.university, p.shortName, p.city]).map(fold).filter(Boolean));

  /* ------------------------------------------------- the catalogue, signed out */
  const cat1 = (await req('guest', 'GET', '/api/catalogue')).body || {};
  const cat2 = (await req('guest', 'GET', '/api/catalogue')).body || {};
  const locked = (cat1.programmes || []).filter(isLocked);
  ok('signed out, the public rows are locked', locked.length > 0 && cat1.gate === 'gated', locked.length + ' locked, gate ' + cat1.gate);

  ok('no locked row carries nLen or uLen (or any other length)',
    locked.every(p => p.nLen === undefined && p.uLen === undefined && !Object.keys(p).some(k => /len$/i.test(k))),
    JSON.stringify(locked.find(p => p.nLen !== undefined || p.uLen !== undefined) || {}).slice(0, 200));
  ok('no locked row carries a name, university, city, slug or url',
    locked.every(p => !p.program && !p.university && !p.shortName && !p.city && !p.slug && !p.url && !p.universitySlug && !p.logo));

  /* The tags: never the title, the title minus its degree, a long piece of
     the title, or any university / city name. */
  const titleSet = new Set(titles), bareSet = new Set(bareTitles);
  const leakedTags = [];
  locked.forEach(p => (p.tags || []).forEach(t => {
    const k = fold(t);
    if (!k || k === fold(p.field)) return;   // the row's own field travels on the row anyway
    /* A tag that equals SOME programme's title is a leak unless it is a
       subject many programmes share ("Economics", "Physics" are titles
       somewhere and the tag search's whole point everywhere). */
    const subject = T.lookup(t) && (T.lookup(t).type === 'Bachelor' || T.lookup(t).count >= 10);
    /* Equal to some OTHER programme's title: fine when the office's sheet
       gives the phrase to three or more programmes (it is a subject there,
       and says nothing about which row it sits on). */
    const shared = T.lookup(t) && T.lookup(t).count >= 3;
    if (titleSet.has(k) && !subject && !shared) leakedTags.push(t + ' (a title)');
    else if (bareSet.has(k) && !subject && !shared) leakedTags.push(t + ' (a title minus its degree)');
    else if (uniNames.has(k)) leakedTags.push(t + ' (a university or city)');
    else if (k.length > 18 && !subject && titles.some(x => x.includes(k))) leakedTags.push(t + ' (a long piece of a title)');
    else if (['University', 'City', 'State'].includes(T.typeOf(t))) leakedTags.push(t + ' (identity type)');
  }));
  ok('no locked row\'s tags name it', leakedTags.length === 0, leakedTags.slice(0, 5).join('; '));
  ok('but the locked rows still carry category tags to search on',
    locked.some(p => (p.tags || []).includes('No German Required')) && locked.some(p => (p.tags || []).some(t => /deadline|winter|summer/i.test(t))),
    JSON.stringify((locked[0] || {}).tags));

  /* The university key: groups within one response, never across two. */
  const unis1 = new Set(locked.map(p => p.uKey)).size;
  ok('uKey still groups locked rows into universities within one response', unis1 > 1 && unis1 < locked.length, unis1 + ' universities for ' + locked.length + ' rows');
  const byId2 = new Map((cat2.programmes || []).filter(isLocked).map(p => [p.id, p.uKey]));
  const sameKey = locked.filter(p => byId2.get(p.id) === p.uKey).length;
  ok('the uKey of every locked row differs between two requests', sameKey === 0, sameKey + ' rows kept their key');
  const keys1 = new Set(locked.map(p => p.uKey)), keys2 = new Set([...byId2.values()]);
  ok('and no key from one response appears in the other', [...keys1].every(k => !keys2.has(k)));
  ok('no locked row\'s uKey is a real university key (u + 8 hex)', locked.every(p => !/^u[0-9a-f]{8}$/.test(String(p.uKey))));

  /* ------------------------------------------ the search box, signed out */
  for (const q of ['aalen', 'stuttgart', 'munich', 'bremen']) {
    const r = (await req('guest', 'GET', '/api/find/unis?q=' + q)).body || {};
    const keys = new Set(r.keys || []);
    const lit = locked.filter(p => keys.has(String(p.uKey))).length;
    ok('/api/find/unis?q=' + q + ' lights up no locked row', lit === 0, lit + ' rows; keys ' + JSON.stringify([...keys]).slice(0, 80));
    ok('  · and hands out no real university key of a hidden university',
      [...keys].every(k => !real.some(p => String(p.uKey) === k && !(cat1.programmes || []).some(x => x.university === p.university))));
  }

  /* The home finder's and Find University's own search (server/find.js is
     what both run), over the rows the visitor was given. A hidden title or
     university name must find no locked row; a category tag must. */
  const rows = (cat1.programmes || []).filter(p => p.level && p.field);
  const countries = cat1.countries || {};
  const run = (query, uniKeys) => F.run(rows, F.parse(query), R, { countries, uniKeys: uniKeys || null });
  /* Pick a word that is in a hidden title and in no public tag. */
  const tagWords = new Set(locked.flatMap(p => (p.tags || []).flatMap(t => fold(t).split(' '))));
  const fieldWords = new Set(locked.flatMap(p => fold(p.field).split(' ')));
  let probe = null;
  for (const t of titles) for (const w of t.split(' ')) {
    if (w.length >= 6 && !tagWords.has(w) && !fieldWords.has(w) && !/^(master|masters|bachelor|programme|degree|science|sciences|studies|international)$/.test(w)) { probe = w; break; }
    if (probe) break;
  }
  ok('there is a title word that is in no public tag (the probe)', !!probe, probe);
  if (probe) {
    const r = run('q=' + probe);
    ok('searching a hidden title word ("' + probe + '") finds no locked row', r.rows.filter(p => p._locked).length === 0, r.rows.filter(p => p._locked).length);
  }
  for (const q of ['manuscript', 'aalen', 'stuttgart']) {
    const unis = (await req('guest', 'GET', '/api/find/unis?q=' + q)).body || {};
    const r = run('q=' + q, unis.keys || []);
    ok('searching "' + q + '" finds no locked row', r.rows.filter(p => p._locked).length === 0, r.rows.filter(p => p._locked).length);
  }
  const noGerman = run('tags=No German Required');
  ok('the tag "No German Required" still finds locked rows', noGerman.rows.filter(p => p._locked).length > 0, noGerman.total);
  const winter = run('tags=Winter');
  ok('the tag "Winter" still finds locked rows', winter.rows.filter(p => p._locked).length > 0, winter.total);
  const subjectTag = (locked.flatMap(p => p.tags || []).find(t => { const e = T.lookup(t); return e && e.type === 'Bachelor'; }));
  if (subjectTag) {
    const s = run('tags=' + subjectTag);
    ok('a subject tag ("' + subjectTag + '") still finds locked rows', s.rows.filter(p => p._locked).length > 0, s.total);
  }

  /* The server-rendered Find University page agrees. */
  for (const q of ['manuscript', 'aalen']) {
    const html = (await req('guest', 'GET', '/find-university?q=' + q)).text;
    const lockedRows = (html.match(/class="frow locked"/g) || []).length;
    ok('/find-university?q=' + q + ' draws no locked row', lockedRows === 0, lockedRows);
  }
  const tagged = (await req('guest', 'GET', '/find-university?tags=' + encodeURIComponent('No German Required'))).text;
  ok('/find-university?tags=No German Required draws locked rows', /class="frow locked"/.test(tagged));
  const blurs = [...tagged.matchAll(/class="ftitle masked"[^>]*>([^<]*)</g)].map(m => m[1].length);
  ok('and the blur on every locked row is one of two fixed widths, not the hidden length',
    blurs.length > 0 && blurs.every(n => n === 22 || n === 26), JSON.stringify([...new Set(blurs)]));
  const uniBlurs = [...tagged.matchAll(/<span class="masked" aria-hidden="true">([^<]*)<\/span> · /g)].map(m => m[1].length);
  ok('  · and so is the university blur', uniBlurs.length > 0 && uniBlurs.every(n => n === 16 || n === 14), JSON.stringify([...new Set(uniBlurs)]));

  /* The home page's locked rows (find.js is shared; index.html has its own
     filler) — the page source itself carries no public row at all. */
  const home = (await req('guest', 'GET', '/')).text;
  const homeJs = home.match(/src="(\/js\/index\.[0-9a-f]+\.js)"/);
  const js = homeJs ? (await req('guest', 'GET', homeJs[1])).text : home;
  ok('the home page\'s script carries no baked public row (no real uKey, no nLen with it)',
    !/"isPublic":\s*true/.test(js) && !/"id":\s*"gated-/.test(js) && !/"isPublic":\s*true[^}]*"nLen"/.test(js));

  /* ------------------------------------- /api/universities/search: no counts */
  const s = (await req('guest', 'GET', '/api/universities/search?q=university')).body || {};
  ok('/api/universities/search still finds universities', (s.universities || []).length > 0);
  ok('  · and gives no programme count', (s.universities || []).every(u => u.programmes === undefined && u.count === undefined),
    JSON.stringify((s.universities || [])[0]));
  const uniPage = s.universities && s.universities[0] ? (await req('guest', 'GET', s.universities[0].url)).text : '';
  ok('a university page has no "Programmes we track" fact', uniPage && !/Programmes we track/.test(uniPage));
  const list = (await req('guest', 'GET', '/university')).text;
  ok('the /university list shows no per-university programme count', !/\d+ programmes? →/.test(list));

  /* --------------------------------------- a student with a package still sees */
  const pw = 'testing12345';
  const email = 'r175-' + Date.now() + '@glovels.com';
  const made = await req('staff', 'POST', '/api/staff/people', { name: 'Leak Test', email, role: 'student', password: pw });
  ok('a student account can be made', made.ok, made.status);
  const sl = await req('stu', 'POST', '/api/auth/login', { email, password: pw });
  ok('and signed in', sl.ok, sl.status);
  const before = (await req('stu', 'GET', '/api/catalogue')).body || {};
  ok('before paying, the student sees no public name', (before.programmes || []).filter(p => p.isPublic && p.university).length === 0);
  const order = await req('stu', 'POST', '/api/orders', { packageId: 'pkg-roadmap', name: 'L', email, phone: '9876543210', acceptedTerms: true });
  ok('an order is placed', order.ok && order.body && order.body.publicUnis > 0, order.status + ' ' + JSON.stringify(order.body || {}).slice(0, 120));
  const after = (await req('stu', 'GET', '/api/catalogue')).body || {};
  const named = (after.programmes || []).filter(p => p.isPublic && p.university);
  const namedUnis = new Set(named.map(p => p.uKey));
  ok('after paying, the package\'s universities come back named', named.length > 0 && namedUnis.size === (order.body || {}).publicUnis,
    namedUnis.size + ' named of ' + (order.body || {}).publicUnis + ' promised');
  ok('  · with their own tags (the title among them is fine on a named row)', named.every(p => Array.isArray(p.tags) && p.tags.length > 0));
  const stillLocked = (after.programmes || []).filter(isLocked);
  ok('  · and the rest stay locked, without lengths', stillLocked.length > 0 && stillLocked.every(p => p.nLen === undefined && p.uLen === undefined));
  /* The search box names exactly what the catalogue names. */
  const namedUni = named[0];
  const word = fold(namedUni.shortName || namedUni.university).split(' ').find(w => w.length >= 4 && !/^(university|hochschule|of|the|technische|technical|applied|sciences)$/.test(w));
  if (word) {
    const r = (await req('stu', 'GET', '/api/find/unis?q=' + word)).body || {};
    ok('the paid student\'s search box finds a named university ("' + word + '")', (r.keys || []).includes(String(namedUni.uKey)), JSON.stringify(r.keys || []).slice(0, 100));
    const g = (await req('guest', 'GET', '/api/find/unis?q=' + word)).body || {};
    ok('  · which a visitor\'s does not', !(g.keys || []).includes(String(namedUni.uKey)), JSON.stringify(g.keys || []).slice(0, 100));
  }
  const stuRows = (after.programmes || []).filter(p => p.level && p.field);
  const stuRun = F.run(stuRows, F.parse('tags=No German Required'), R, { countries });
  ok('tag search works for the paid student too, over named and locked rows alike',
    stuRun.rows.some(p => p._locked) && stuRun.rows.some(p => p.isPublic && !p._locked), stuRun.total);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
