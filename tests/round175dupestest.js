/*
 * Round 175 — baked German rows that duplicate an office-sheet row are
 * retired when the sheet is imported (deep test 26 Oct, item 3).
 * Port 8122 by default (BASE overrides). Loads the live German sheet from the
 * session scratchpad; skips (passes) if the sheet is not on this machine.
 */
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8122';
const SHEET = process.env.SHEET || '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad/r165/live-DE-noid.xlsx';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); } };
function done() { console.log('round175dupestest: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const jar = {};
async function req(who, method, p, body, raw) {
  const h = {};
  if (!raw) h['content-type'] = 'application/json';
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + p, { method, headers: h, body: raw ? body : (body === undefined ? undefined : JSON.stringify(body)) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {}, text };
}

(async () => {
  if (!fs.existsSync(SHEET)) { console.log('  (sheet not found — skipping)'); return done(); }
  let r = await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
  ok('admin signs in', r.ok, r.status);

  /* Before: the baked German rows are on the site. */
  r = await req('a', 'GET', '/api/staff/catalogue?per=5000&status=');
  const before = (r.body.programmes || []);
  const bakedBefore = before.filter(p => /^(gated-|9000)/.test(String(p.id)) && p.country === 'DE' && p.active);
  ok('baked German rows exist before the import', bakedBefore.length > 50, bakedBefore.length);
  const aalen = bakedBefore.find(p => /aalen/i.test(p.university) && /advanced materials/i.test(p.program));
  ok('Aalen Advanced Materials is one of them', !!aalen, aalen && aalen.id);

  /* A student holds the baked row on their shortlist. */
  r = await req('s', 'POST', '/api/auth/signup', { name: 'Dupe Holder', email: 'dupe-holder-' + Date.now() + '@example.com', phone: '9811100175', password: 'dupe-holder-pw', acceptedTerms: true });
  ok('a student signs up', r.ok, r.status + ' ' + r.text.slice(0, 120));
  const sid = Number(((await req('s', 'GET', '/api/auth/me')).body.user || {}).id);
  if (sid && aalen) {
    r = await req('a', 'POST', '/api/staff/student/' + sid + '/shortlist', { id: aalen.id, force: true });
    ok('the baked row is on their shortlist', r.ok || r.status === 409, r.status + ' ' + r.text.slice(0, 120));
  }

  /* Import the office sheet. */
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(SHEET)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), path.basename(SHEET));
  fd.append('confirm', 'yes'); fd.append('skipBad', 'yes');
  r = await req('a', 'POST', '/api/staff/catalogue/import', fd, true);
  ok('the sheet imports', r.ok && r.body.applied, r.status + ' ' + r.text.slice(0, 160));
  ok('the import reports retired baked rows', Number(r.body.retired) > 20, r.body.retired);

  r = await req('a', 'GET', '/api/staff/catalogue?per=5000&status=');
  const after = (r.body.programmes || []);
  const byId = new Map(after.map(p => [String(p.id), p]));
  const aalenAfter = aalen && byId.get(String(aalen.id));
  ok('the baked Aalen row is now hidden', aalenAfter && !aalenAfter.active, aalenAfter && aalenAfter.active);
  const officeAalen = after.find(p => /^own-/.test(String(p.id)) && /aalen/i.test(p.university) && /advanced materials/i.test(p.program) && p.active);
  ok('the office Aalen row is live', !!officeAalen, officeAalen && officeAalen.id);

  /* Nothing on the site twice. */
  const fold = s => String(s || '').toLowerCase().replace(/^\s*(m\.?sc|b\.?sc|m\.?a|b\.?a|m\.?eng|mba)\.?\s*/i, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const seen = new Map(); let dupes = 0;
  after.filter(p => p.active && p.country === 'DE').forEach(p => {
    const k = p.university.toLowerCase() + '|' + fold(p.program);
    if (seen.has(k) && (/^(gated-|9000)/.test(seen.get(k)) !== /^(gated-|9000)/.test(String(p.id)))) dupes++;
    seen.set(k, String(p.id));
  });
  ok('no live baked row shares its name with a live office row', dupes === 0, dupes);

  /* The student's shortlist moved to the office row. */
  if (sid && officeAalen) {
    r = await req('a', 'GET', '/api/staff/student/' + sid);
    const ids = JSON.stringify(r.body.shortlist || r.body);
    ok('their shortlist now holds the office row', ids.includes(String(officeAalen.id)) && !ids.includes(String(aalen.id)), ids.slice(0, 200));
  }

  /* Baked rows with no office twin stay. */
  const bakedLeft = after.filter(p => /^(gated-|9000)/.test(String(p.id)) && p.country === 'DE' && p.active);
  ok('baked rows without a sheet twin are left alone', bakedLeft.length > 0 && bakedLeft.length < bakedBefore.length, bakedLeft.length + ' of ' + bakedBefore.length);

  done();
})().catch(e => { console.error(e); fail++; done(); });
