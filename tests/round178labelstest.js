/*
 * Round 178 — loose ends of the data round.
 *
 *   1. An indicative (agent-portal) fee never reaches a visitor on the
 *      server-rendered Find University page (findpage.js publicRows), the
 *      university page, its programme pages, the lists or the student's
 *      shortlist; the counsellor keeps it, labelled "(indicative)".
 *   2. A university whose rows are ALL indicative (an agent-portal import —
 *      stored non-public so its name is not locked) carries NO public /
 *      private label anywhere: pills, datelines, fact rows, list suffixes,
 *      the finder row, the derived tags. A university with any direct row,
 *      and every German row, keeps its label (UNIS.typeLabel).
 *
 * Port 8136 by default (BASE overrides).
 */
const SHEET = require('../server/sheet.js');
const UNIS = require('../server/unis.js');
const FIND = require('../server/find.js');
const TAGS = require('../server/tags.js');
const BASE = process.env.BASE || 'http://localhost:8136';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); } };

const jar = {};
async function req(who, method, p, body, raw) {
  const h = {};
  if (!raw && body !== undefined) h['content-type'] = 'application/json';
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: raw ? body : (body === undefined ? undefined : JSON.stringify(body)) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {}, text };
}
async function upload(who, name, headers, rows) {
  const fd = new FormData();
  fd.append('file', new Blob([SHEET.writeXlsx(headers, rows, 'Catalogue')]), name);
  fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
  return req(who, 'POST', '/api/staff/catalogue/import', fd, true);
}
const stamp = String(Date.now()).slice(-6);
const money = n => '₹' + (n / 1e5).toFixed(n % 1e5 ? 1 : 0).replace(/\.0$/, '') + ' lakh';
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = s.indexOf(b, i + a.length); return s.slice(i, j < 0 ? undefined : j); };

(async () => {
  /* =========================================== the helper, on fixtures */
  console.log('\n— UNIS.typeLabel / FIND.typeLabel on fixtures');
  const ind = (id, extra) => Object.assign({ id, program: 'MSc X' + id, university: 'Fixture Agent University', city: 'Seattle',
    country: 'US', isPublic: false, feeIndicative: true, totalInr: 3000000, level: 'master', field: 'Data Science' }, extra || {});
  const allInd = UNIS.group([ind('f1'), ind('f2')])[0];
  ok('all-indicative university: typeKnown false, feeOnRequest true', allInd.typeKnown === false && allInd.feeOnRequest === true, allInd);
  ok('all-indicative university: typeLabel is empty', UNIS.typeLabel(allInd) === '');
  const mixed = UNIS.group([ind('m1'), ind('m2', { feeIndicative: false, totalInr: 1000000 })])[0];
  ok('a university with a direct row: typeKnown, "Private"', mixed.typeKnown === true && UNIS.typeLabel(mixed) === 'Private');
  const de = UNIS.group([{ id: 'd1', program: 'MSc Y', university: 'Fixture TU', city: 'Berlin', country: 'DE', isPublic: true, feeIndicative: false }])[0];
  ok('a German public university: "Public"', UNIS.typeLabel(de) === 'Public');
  ok('a row: indicative → "", direct → its label', UNIS.typeLabel(ind('r1')) === '' && UNIS.typeLabel({ isPublic: true }) === 'Public'
    && FIND.typeLabel(ind('r2')) === '' && FIND.typeLabel({ isPublic: false }) === 'Private');
  const cnt = { US: { name: 'United States', flag: '' } };
  const visitorRow = FIND.rowHtml(Object.assign(UNIS.publicFee(ind('v1')), { uniSlug: 'fixture-agent-university' }), { countries: cnt });
  ok('finder row (visitor): no "Private university", "Fee on request", no figure',
    !/Private university|Public university/.test(visitorRow) && /Fee on request/.test(visitorRow) && !visitorRow.includes(FIND.money(3000000)), visitorRow.slice(0, 300));
  const staffRow = FIND.rowHtml(Object.assign(ind('s1'), { uniSlug: 'fixture-agent-university' }), { countries: cnt });
  ok('finder row (counsellor, fee kept): the fee with "(indicative)", still no label',
    staffRow.includes(FIND.money(3000000)) && /\(indicative\)/.test(staffRow) && !/Private university/.test(staffRow), staffRow.slice(0, 300));
  ok('derived tags: no "Private University" on an indicative row', !TAGS.derive(ind('t1')).includes('Private University')
    && TAGS.derive({ id: 't2', program: 'MSc Z', university: 'U', isPublic: false }).includes('Private University'));
  ok('stored tags: an import\'s "Private University" is dropped on an indicative row',
    !TAGS.tagsOf(ind('t3', { tags: ['Private University', 'Data Science'] })).includes('Private University'));
  ok('sorting by cost: an indicative row never sorts as the cheapest',
    FIND.sortRows([UNIS.publicFee(ind('c1')), { id: 'c2', isPublic: false, totalInr: 900000, program: 'B' }], 'cost', false)[0].id === 'c2');

  /* ===================================================== the live server */
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.ok, r.status);
  console.log('\n— an all-indicative university on the live pages');
  const UNI = 'Testwash Agent University ' + stamp;
  const MIX = 'Testmix Agent College ' + stamp;
  const FEE = 2765430, FEE2 = 1123450;
  const H = ['id', 'programme', 'university', 'city', 'country code', 'level', 'field', 'public university',
    'application', 'total tuition inr', 'course url', 'fee indicative', 'on the site'];
  r = await upload('a', 'labels.xlsx', H, [
    ['', 'MSc Wash Data ' + stamp, UNI, 'Seattle', 'CA', 'master', 'Data Science, AI & Machine Learning', 'no', 'Free', FEE, 'https://example.org/w1', 'yes', 'yes'],
    ['', 'MSc Wash Cloud ' + stamp, UNI, 'Seattle', 'CA', 'master', 'Computer Science & IT', 'no', 'Free', FEE, 'https://example.org/w2', 'yes', 'yes'],
    ['', 'MSc Mix Agent ' + stamp, MIX, 'Halifax', 'CA', 'master', 'Data Science, AI & Machine Learning', 'no', 'Free', FEE, 'https://example.org/m1', 'yes', 'yes'],
    ['', 'MSc Mix Direct ' + stamp, MIX, 'Halifax', 'CA', 'master', 'Data Science, AI & Machine Learning', 'no', 'Free', FEE2, 'https://example.org/m2', 'no', 'yes'],
  ]);
  ok('fixture imported: four rows', r.ok && r.body.created === 4, r.body);
  const slug = UNIS.slugOf(UNI), mslug = UNIS.slugOf(MIX);

  r = await req('v', 'GET', '/find-university?country=CA&q=' + encodeURIComponent('Wash Data ' + stamp));
  ok('Find University renders', r.status === 200, r.status);
  ok('Find University (server render): the indicative figure is nowhere', !r.text.includes(money(FEE)) && !r.text.includes(FIND.money(FEE)) && !r.text.includes(String(FEE)));
  r = await req('v', 'GET', '/find-university?country=CA');
  const art = between(r.text, 'MSc Wash Data ' + stamp, '</article>');
  ok('Find University (server render): the row is drawn', !!art, r.text.length);
  ok('Find University row: no "Private university", "Fee on request"', art && !/Private university|Public university/.test(art) && /Fee on request/.test(art), art.slice(0, 400));
  ok('Find University (server render): no indicative figure on the page', !r.text.includes(money(FEE)) && !r.text.includes(FIND.money(FEE)) && !r.text.includes(String(FEE)));
  r = await req('v', 'GET', '/find-university?country=CA&sort=cost');
  ok('Find University by cost: still no figure', r.status === 200 && !r.text.includes(money(FEE)) && !r.text.includes(FIND.money(FEE)) && !r.text.includes(String(FEE)));

  r = await req('v', 'GET', '/university/' + slug);
  ok('university page renders', r.status === 200, r.status);
  const main = r.text.replace(/<footer[\s\S]*$/, '');
  ok('university page: no "Private university" anywhere', !/Private university|private university/.test(main), (main.match(/.{60}[Pp]rivate university.{30}/) || [''])[0]);
  ok('university page: no Public/Private pill', !/class="pill (pub|priv)"/.test(main));
  ok('university page: no "Type" fact row', !/<span>Type<\/span>/.test(main));
  ok('university page: no "Private" hero chip', !/data-chips="[^"]*Private/.test(main));
  ok('university page: the fee line says "Fees from a counsellor"', /Fees from a counsellor/.test(main));
  ok('university page: no indicative figure', !main.includes(money(FEE)) && !main.includes(String(FEE)));
  const ld = [...r.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch (e) { return null; } });
  ok('university page: JSON-LD still a CollegeOrUniversity, no public/private in it',
    ld.some(x => x && x['@type'] === 'CollegeOrUniversity' && x.name === UNI) && !ld.some(x => x && /Private|Public university/.test(JSON.stringify(x))), ld.map(x => x && x['@type']));
  const progHref = (main.match(new RegExp('href="(/university/' + slug + '/[^"#]+)"')) || [])[1];
  if (progHref) {
    r = await req('v', 'GET', progHref);
    const pm = r.text.replace(/<footer[\s\S]*$/, '');
    ok('programme page: renders, no "Private university", no figure', r.status === 200 && !/Private university|private university/.test(pm)
      && !pm.includes(money(FEE)) && !pm.includes(String(FEE)), progHref);
  } else ok('programme page: linked from the university page', false, 'no link');

  r = await req('v', 'GET', '/university/' + mslug);
  ok('a university with one direct row keeps "Private university"', r.status === 200 && /Private university/.test(r.text));

  r = await req('v', 'GET', '/university');
  const li = between(r.text, '<b>' + UNI + '</b>', '</li>');
  ok('/university list: the row has no "Private"', li && !/Private|Public/.test(li), li);
  ok('/university list: a German row keeps its label', /<small>(Public|Private) · /.test(r.text));
  r = await req('v', 'GET', '/study-in-canada');
  const li2 = between(r.text, '<b>' + UNI + '</b>', '</li>') || between(r.text, UNI, '</li>');
  ok('/study-in-canada: the row has no "Private"', r.status === 200 && li2 && !/Private|Public/.test(li2), li2 || r.status);
  ok('/study-in-canada: no indicative figure', !r.text.includes(money(FEE)));
  r = await req('v', 'GET', '/api/universities/filter?country=CA&q=' + encodeURIComponent('Testwash'));
  const fu = (r.body.universities || []).find(u => u.slug === slug);
  ok('/api/universities/filter: typeLabel "" and feeOnRequest', fu && fu.typeLabel === '' && fu.feeOnRequest === true, fu || r.body);
  r = await req('v', 'GET', '/api/universities/filter?country=CA&q=' + encodeURIComponent('Testmix'));
  const fm = (r.body.universities || []).find(u => u.slug === mslug);
  ok('/api/universities/filter: a mixed university is "Private"', fm && fm.typeLabel === 'Private' && !fm.feeOnRequest, fm || r.body);

  r = await req('v', 'GET', '/api/catalogue');
  const vr = (r.body.programmes || []).filter(p => p.university === UNI);
  ok('/api/catalogue (visitor): no "Private University" tag, no fee', vr.length === 2
    && vr.every(p => !(p.tags || []).includes('Private University') && !p.totalInr && p.feeIndicative === true), vr[0]);
  r = await req('v', 'GET', '/');
  ok('home page: no indicative figure baked in', r.status === 200 && !r.text.includes(String(FEE)));
  r = await req('v', 'GET', '/dashboard.html');
  ok('dashboard: the agent row\'s label is optional (typeOf)', r.status !== 200 || /const typeOf = p =>/.test(r.text));

  /* Staff keep the figure, labelled. */
  r = await req('a', 'GET', '/api/catalogue');
  const ar = (r.body.programmes || []).find(p => p.university === UNI);
  ok('staff /api/catalogue: the fee and the flag', ar && ar.totalInr === FEE && ar.feeIndicative === true, ar);

  /* The student. */
  r = await req('s', 'POST', '/api/auth/login', { email: 'student@glovels.com', password: 'glovels123' });
  ok('student signs in', r.ok, r.status);
  const id = (vr[0] || {}).id;
  r = await req('s', 'POST', '/api/shortlist', { id });
  ok('student adds the indicative programme', r.ok, r.status + ' ' + r.text.slice(0, 100));
  r = await req('s', 'GET', '/api/state');
  const sl = (r.body.shortlist || []).find(x => x.id === id);
  ok('student /api/state: no fee, feeHidden and feeIndicative', sl && !sl.totalInr && sl.feeHidden === true && sl.feeIndicative === true, sl);
  ok('student /api/state: the figure appears nowhere', !r.text.includes(String(FEE)));

  console.log('round178labelstest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
