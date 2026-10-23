/*
 * Round 173 — the counsellor's matcher offers every country (23 Oct).
 *
 * The Destination box was a datalist pre-filled with "Germany", so the
 * dropdown showed one option and the counsellor thought Germany was all
 * there was. Now: a select with "Any country" plus every catalogue country,
 * and the server resolves any ISO country name, not just the dozen it knew.
 *
 * Port 8116 by default (BASE overrides). Needs a catalogue with more than
 * one country — the baked one has UK, Poland, Canada, Germany…
 */
const BASE = process.env.BASE || 'http://localhost:8116';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); } };
function done() { console.log('round173test: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {};
async function req(who, method, p, body) {
  const h = { 'content-type': 'application/json', 'x-forwarded-for': '10.173.0.' + (who.length + 1) };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {}, text };
}

(async () => {
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.ok, r.status);

  /* The page: a select, "Any country" first, no datalist. */
  const js = await (await fetch(BASE + '/fitpanel.js')).text();
  ok('the destination box is a dropdown with Any country first', /sel\('gfCountry', \[\['', 'Any country'\]\]/.test(js));
  ok('the old datalist is gone', !/list="gfCountries"/.test(js));
  ok('the list grows to the whole catalogue', /loadCountries\(\)/.test(js) && /\/api\/staff\/catalogue\?per=1/.test(js));

  /* The catalogue tells the page its countries. */
  r = await req('a', 'GET', '/api/staff/catalogue?per=1');
  const cs = (r.body.countries || []).filter(c => c.active).map(c => c.name);
  ok('the catalogue lists more than one active country', cs.length > 1, cs);

  const base = { g_level: "Master's", g_field: 'Computer Science', d_cgpa: '8', d_max: '10' };
  const countriesOf = out => {
    const seen = new Set();
    [].concat(out.fits || [], out.near || []).forEach(p => seen.add(p.country || p.countryCode || p.cc));
    return [...seen].filter(Boolean);
  };

  r = await req('a', 'POST', '/api/staff/fit', { filters: Object.assign({ g_country: '' }, base) });
  ok('Any country: the matcher answers', r.ok, r.status);
  const anyC = countriesOf(r.body);
  ok('Any country: rows come from more than one country', anyC.length > 1, anyC);

  r = await req('a', 'POST', '/api/staff/fit', { filters: Object.assign({ g_country: 'Poland' }, base) });
  const pl = countriesOf(r.body);
  ok('Poland: only Polish rows', pl.length === 1 && /^PL$|Poland/i.test(pl[0]), pl);

  r = await req('a', 'POST', '/api/staff/fit', { filters: Object.assign({ g_country: 'United Kingdom' }, base) });
  const gb = countriesOf(r.body);
  ok('United Kingdom: only UK rows', gb.length === 1 && /^GB$|United Kingdom/i.test(gb[0]), gb);

  /* A country the matcher did not know by name resolves through the ISO list. */
  const M = require('../server/matches.js');
  const w = M.wants ? M.wants({ g_country: 'New Zealand' }) : null;
  ok('an ISO name the old map lacked resolves (New Zealand → NZ)', !w || (w.countries && w.countries[0] === 'NZ'), w && w.countries);

  done();
})().catch(e => { console.error(e); fail++; done(); });
