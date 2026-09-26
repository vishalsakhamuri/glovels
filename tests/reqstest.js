/*
 * Patch 139 — what a programme asks for, end to end over HTTP.
 *
 * The record (server/reqs.js) has one owner and travels as one column, so
 * the checks here are about the DOORS it goes through: the admin form's
 * save, the sheet down and back up, the public catalogue, and the finder's
 * own page — and about the one rule that must hold at every door: blank
 * means not stated, and not stated never rules anybody out.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const jar = {};
async function req(who, method, path, body, raw) {
  const h = {};
  if (!raw) h['content-type'] = 'application/json';
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: raw ? body : (body === undefined ? undefined : JSON.stringify(body)) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j, text };
}
const S = require('../server/sheet.js');
const R = require('../server/reqs.js');

(async () => {
  const stamp = Date.now().toString(36);
  await req('a', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });

  /* ---- 1. the admin form's save ---- */
  let r = await req('a', 'PUT', '/api/staff/programme', {
    program: 'Reqs Test MSc ' + stamp, university: 'Reqs Test University', country: 'DE', level: 'master',
    field: 'Computer Science & IT', isPublic: false, feeModel: 'free', totalInr: 0, url: 'https://example.org/reqs',
    intakes: [{ season: 'winter', deadline: '2027-07-15' }],
    reqs: { ieltsMin: '6.5', toeflMin: '', germanLevel: 'a2', bachelorSubjects: 'Computer Science or IT', bachelorYears: '4', workExpRequired: 'no', greRequired: '', papersRequired: 'no', tuitionEurSem: '0' },
  });
  ok('a programme saves with what it asks for', r.ok, r.status + ' ' + (r.body && r.body.error));
  const id = r.body && (r.body.id || (r.body.programme && r.body.programme.id));
  ok('  · and comes back with an id', !!id, JSON.stringify(r.body).slice(0, 120));

  r = await req('a', 'GET', '/api/catalogue');
  const list = (r.body && (r.body.programmes || r.body)) || [];
  const mine = list.find(p => String(p.id) === String(id));
  ok('the public catalogue carries the record', !!mine && mine.reqs && mine.reqs.ieltsMin === 6.5, JSON.stringify(mine && mine.reqs));
  ok('  · blank arrived as null, never zero', mine && mine.reqs.toeflMin === null && mine.reqs.greRequired === null);
  ok('  · tuition 0 is zero, not blank', mine && mine.reqs.tuitionEurSem === 0);
  ok('  · the level is upper-cased, the flags are booleans', mine && mine.reqs.germanLevel === 'A2' && mine.reqs.workExpRequired === false && mine.reqs.papersRequired === false);

  /* ---- 2. refused in the form's own words, naming the box ---- */
  r = await req('a', 'PUT', '/api/staff/programme', Object.assign({}, { id, program: 'Reqs Test MSc ' + stamp, university: 'Reqs Test University', country: 'DE', level: 'master', field: 'Computer Science & IT', isPublic: false, feeModel: 'free', totalInr: 0, intakes: [{ season: 'winter', deadline: '2027-07-15' }] },
    { reqs: { ieltsMin: '12', germanLevel: 'fluent' } }));
  ok('an IELTS of 12 is refused, not clamped', r.status === 422, r.status);
  ok('  · in the sentence the form shows', r.body && /IELTS minimum has to be between 4 and 9\. You entered "12"\./.test(r.body.error || ''), r.body && r.body.error);
  ok('  · naming the box', r.body && Array.isArray(r.body.fields) && r.body.fields.some(f => f.field === 'reqs.ieltsMin') && r.body.fields.some(f => f.field === 'reqs.germanLevel'), JSON.stringify(r.body && r.body.fields));
  r = await req('a', 'GET', '/api/catalogue');
  const still = ((r.body && (r.body.programmes || r.body)) || []).find(p => String(p.id) === String(id));
  ok('  · and the stored record is untouched', still && still.reqs.ieltsMin === 6.5);

  /* ---- 3. a save WITHOUT reqs keeps them (the rename case) ---- */
  r = await req('a', 'PUT', '/api/staff/programme', { id, program: 'Reqs Test MSc renamed ' + stamp, university: 'Reqs Test University', country: 'DE', level: 'master', field: 'Computer Science & IT', isPublic: false, feeModel: 'free', totalInr: 0, intakes: [{ season: 'winter', deadline: '2027-07-15' }] });
  ok('a save that does not mention the requirements', r.ok, r.status);
  r = await req('a', 'GET', '/api/catalogue');
  const kept = ((r.body && (r.body.programmes || r.body)) || []).find(p => String(p.id) === String(id));
  ok('  · keeps them', kept && kept.reqs.ieltsMin === 6.5 && kept.reqs.germanLevel === 'A2', JSON.stringify(kept && kept.reqs));

  /* ---- 4. the sheet, down ---- */
  r = await req('a', 'GET', '/api/staff/catalogue.csv?country=DE');
  ok('the German sheet downloads', r.status === 200, r.status);
  const rows = S.readCsv(r.text);
  const H = rows[0];
  ok('  · with one column per requirement, at the end', R.SHEET_HEADERS.every(h => H.includes(h)) && H.slice(-R.SHEET_HEADERS.length).join('|') === R.SHEET_HEADERS.join('|'), H.slice(-3).join('|'));
  const line = rows.find(x => String(x[H.indexOf('id')]) === String(id));
  ok('  · and the row carries what was saved', line && line[H.indexOf('ielts min')] === '6.5' && line[H.indexOf('german level')] === 'A2' && line[H.indexOf('papers required')] === 'no', line && line.slice(-R.SHEET_HEADERS.length).join('|'));

  /* ---- 5. the sheet, back up: a change previews as a change to reqs ---- */
  const edited = rows.map(x => x.slice());
  const li = edited.findIndex(x => String(x[H.indexOf('id')]) === String(id));
  edited[li][H.indexOf('ielts min')] = '7';
  edited[li][H.indexOf('work exp required')] = 'yes';
  edited[li][H.indexOf('work exp months')] = '12 months';
  const upload = async (headers, body, confirm) => {
    const csv = S.writeCsv(headers, body);
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'sheet.csv');
    if (confirm) fd.append('confirm', 'yes');
    return req('a', 'POST', '/api/staff/catalogue/import', fd, true);
  };
  r = await upload(H, edited.slice(1).filter(x => String(x[H.indexOf('id')]) === String(id)), false);
  ok('the preview sees the change', r.ok && r.body && r.body.plan, r.status + ' ' + (r.body && r.body.error));
  const up = r.body && r.body.plan && r.body.plan.update.find(u => String(u.id) === String(id));
  ok('  · as a change to the requirements, and nothing else', up && up.changed.join(',') === 'reqs', JSON.stringify(up && up.changed));
  ok('  · with no rows rejected', r.body && r.body.counts && r.body.counts.rejected === 0, JSON.stringify(r.body && r.body.counts));
  r = await upload(H, edited.slice(1).filter(x => String(x[H.indexOf('id')]) === String(id)), true);
  ok('confirmed, it applies', r.ok && r.body && r.body.updated === 1, JSON.stringify(r.body));
  r = await req('a', 'GET', '/api/catalogue');
  const after = ((r.body && (r.body.programmes || r.body)) || []).find(p => String(p.id) === String(id));
  ok('  · IELTS is 7 and "12 months" read as 12', after && after.reqs.ieltsMin === 7 && after.reqs.workExpRequired === true && after.reqs.workExpMonths === 12, JSON.stringify(after && after.reqs));

  /* a bad cell refuses the row, in the same words */
  const badRow = edited[li].slice(); badRow[H.indexOf('toefl min')] = '250';
  r = await upload(H, [badRow], false);
  const rej = r.body && r.body.plan && r.body.plan.rejected[0];
  ok('a TOEFL of 250 on the sheet rejects that row', rej && /TOEFL iBT minimum has to be between 40 and 120/.test((rej.why || []).join(' ')), JSON.stringify(rej));

  /* a sheet WITHOUT the columns leaves them alone */
  const narrow = H.filter(h => !R.SHEET_HEADERS.includes(h));
  const narrowRow = narrow.map(h => edited[li][H.indexOf(h)]);
  r = await upload(narrow, [narrowRow], true);
  ok('an older sheet without the columns uploads', r.ok, r.status + ' ' + (r.body && r.body.error));
  r = await req('a', 'GET', '/api/catalogue');
  const untouched = ((r.body && (r.body.programmes || r.body)) || []).find(p => String(p.id) === String(id));
  ok('  · and leaves the requirements exactly as they were', untouched && untouched.reqs.ieltsMin === 7 && untouched.reqs.germanLevel === 'A2', JSON.stringify(untouched && untouched.reqs));

  /* ---- 6. the finder's page carries the controls ---- */
  r = await req('x', 'GET', '/');
  ok('the home page has the two upfront boxes', /id="fEnglish"/.test(r.text) && /id="fWork"/.test(r.text));
  ok('  · and the panel behind "More filters"', /id="fMoreBtn"/.test(r.text) && /id="fTuition"/.test(r.text) && /id="fPapers"/.test(r.text) && /id="fGerman"/.test(r.text) && /id="fBachYears"/.test(r.text) && /id="fGre"/.test(r.text));
  ok('  · and the two boxes around the results', /id="rNeed"/.test(r.text) && /id="rTurned"/.test(r.text));
  r = await req('x', 'GET', '/catalogue');
  ok('the catalogue screen has the "What it asks for" section', /What it asks for/.test(r.text) && /'fReq_' \+ key/.test(r.text) && /\['ieltsMin', 'IELTS minimum'/.test(r.text));
  r = await req('x', 'GET', '/profile');
  ok('the profile asks the two the finder reads', /g_german/.test(r.text) && /g_papers/.test(r.text));

  /* tidy */
  await req('a', 'DELETE', '/api/staff/programme/' + encodeURIComponent(id));
  console.log('reqstest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('reqstest crashed: ' + (e && e.stack || e)); process.exit(1); });
