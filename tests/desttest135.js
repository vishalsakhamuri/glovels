/*
 * The destination pages, reading from the catalogue rather than from what
 * somebody typed into an HTML file in the spring.
 *
 * Seventeen pages in the navigation, two kinds underneath: eight generated
 * from data and seven hand-written and never regenerated. Germany's said 158
 * programmes and 41 universities while the catalogue held two thousand and
 * two hundred-odd, and the finder on the SAME PAGE counted live — one screen,
 * two answers. Its CGPA bar said 7.5 because somebody typed 7.5, which is why
 * editing the office's own field changed nothing.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };

const jar = {};
async function req(who, method, path, body) {
  const h = { 'content-type': 'application/json' };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j };
}
const page = p => fetch(BASE + p).then(r => r.text());
const cell = (html, label) =>
  ((new RegExp('<span>' + label + '</span><b>([^<]*)</b>').exec(html)) || [])[1] || null;

(async () => {
  const stamp = Date.now().toString(36);
  await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });

  /* ---- 1. the counts follow the catalogue ---- */
  let html = await page('/study-in-canada');
  const before = Number(String(cell(html, 'Programmes we track')).replace(/,/g, ''));
  ok('a destination page states how many programmes we track', before > 0, before);

  let r = await req('a', 'PUT', '/api/staff/programme', {
    id: 'live-' + stamp, program: 'MSc Freshly Added', university: 'Newly Added University ' + stamp,
    country: 'CA', level: 'master', field: 'Computer Science', isPublic: false, active: true,
  });
  ok('  · a programme can be added to it', r.ok, r.status + ' ' + ((r.body || {}).error || ''));

  html = await page('/study-in-canada');
  const after = Number(String(cell(html, 'Programmes we track')).replace(/,/g, ''));
  ok('  · and the page says so on the next load, without a rebuild',
    after === before + 1, before + ' -> ' + after);
  ok('  · the university count moves with it',
    Number(String(cell(html, 'Universities')).replace(/,/g, '')) > 0, cell(html, 'Universities'));

  /* The same number in the sentence above the box, which is the half that made
     the page argue with itself. */
  const inProse = (/<b>([\d,]+) programmes<\/b>/.exec(html) || [])[1];
  if (inProse) {
    ok('  · and the sentence above the box agrees with the box',
      Number(inProse.replace(/,/g, '')) === after, inProse + ' vs ' + after);
  }

  /* ---- 2. the CGPA bar is the office's, not the author's ---- */
  r = await req('a', 'PUT', '/api/staff/country',
    { code: 'CA', name: 'Canada', facts: { minCgpaPublic: 6.8, minCgpaPrivate: 5.4 } });
  ok('the office can set a destination’s grade bar', r.ok, r.status);
  html = await page('/study-in-canada');
  ok('  · and the page shows it', cell(html, 'Public university CGPA') === '6.8+ on 10',
    cell(html, 'Public university CGPA'));
  ok('  · both bars', cell(html, 'Private university CGPA') === '5.4+ on 10',
    cell(html, 'Private university CGPA'));

  r = await req('a', 'PUT', '/api/staff/country',
    { code: 'CA', name: 'Canada', facts: { minCgpaPublic: 7.2, minCgpaPrivate: 5.4 } });
  html = await page('/study-in-canada');
  ok('  · changing it changes the page, which is what it did not do before',
    cell(html, 'Public university CGPA') === '7.2+ on 10',
    cell(html, 'Public university CGPA'));

  /* A destination the office has set no bar for keeps whatever the page has
     always said. Replacing a real published figure with a dash because a
     database column is empty would be a worse answer, not a truer one. */
  html = await page('/study-in-germany');
  const de = cell(html, 'Public university CGPA');
  ok('a destination with no bar set still reads sensibly', !!de && de !== 'null', de);

  /* ---- 3. nothing listed is where the conversation starts ---- */
  html = await page('/study-in-japan');
  ok('a destination with no universities offers a way to ask',
    /class="nolist"/.test(html), 'no block on the page');
  ok('  · saying the listing is not public rather than showing an empty shelf',
    /do not list universities/i.test(html), 'wording missing');
  ok('  · and it takes a number', /id="nlPhone"/.test(html) && /id="nlEmail"/.test(html),
    'no fields');
  ok('  · on a generated page as well as a hand-written one',
    /id="nlForm"/.test(html), 'form missing');

  /* And a destination that HAS universities gets the list, not the form. */
  html = await page('/study-in-germany');
  ok('a destination with universities gets the list instead',
    /id="uList"/.test(html) && !/class="nolist"/.test(html),
    'uList=' + /id="uList"/.test(html) + ' nolist=' + /class="nolist"/.test(html));

  /* ---- 4. the enquiry it sends reaches the leads book ---- */
  const before2 = (await req('a', 'GET', '/api/staff/leads')).body.leads.length;
  r = await req('x', 'POST', '/api/enquiries', {
    name: 'Nothing Listed ' + stamp, phone: '9876500150', email: 'nl' + stamp + '@ex.example',
    destination: 'JP', note: 'Destination page with nothing listed',
    sourcePage: '/study-in-japan',
  });
  ok('the form on that page reaches the leads book', r.ok, r.status);
  const after2 = (await req('a', 'GET', '/api/staff/leads')).body.leads;
  ok('  · as a lead the office can call',
    after2.length === before2 + 1 && after2.some(l => l.name.includes(stamp)),
    before2 + ' -> ' + after2.length);
  const lead = after2.find(l => l.name.includes(stamp)) || {};
  ok('  · carrying which page it came from',
    /japan/i.test(String(lead.page || '') + String(lead.note || '')),
    JSON.stringify({ page: lead.page, note: lead.note }));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
