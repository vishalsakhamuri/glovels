/*
 * The nine things five test agents found in a sweep of the whole tool.
 *
 * None of them were in the feature being built at the time. They were in the
 * places nobody had looked at for a while: a filename, a partner's logo, a
 * lead note, a footer link, and three different readings of what day it is.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };

const jar = {};
async function req(who, method, path, body, opts) {
  const o = opts || {};
  const h = Object.assign({ 'content-type': 'application/json' }, o.headers || {});
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, {
    method, headers: h,
    body: o.raw !== undefined ? o.raw : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j, headers: r.headers };
}
const login = (who, e, p) => req(who, 'POST', '/api/auth/login', { email: e, password: p });
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

function multipart(key, filename, bytes) {
  const b = '----glovels' + Math.random().toString(16).slice(2);
  const head = '--' + b + '\r\nContent-Disposition: form-data; name="key"\r\n\r\n'
    + key + '\r\n--' + b
    + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\n'
    + 'Content-Type: application/pdf\r\n\r\n';
  return {
    type: 'multipart/form-data; boundary=' + b,
    data: Buffer.concat([Buffer.from(head), Buffer.from(bytes), Buffer.from('\r\n--' + b + '--\r\n')]),
  };
}

(async () => {
  const stamp = Date.now().toString(36);
  await login('a', 'admin@glovels.com', 'glovels123');

  /* ---- 1. a filename with a carriage return in it ----
     Stored as it arrived, and then written into a Content-Disposition header
     on the way back out. Node will not write that header, so it threw — and
     the document had already been accepted. A student could upload their
     passport and neither they nor their counsellor could ever open it
     again, with no way to rename it and no sign of what had happened. */
  const email = 'r133s' + stamp + '@ex.example';
  let r = await req('a', 'POST', '/api/staff/people',
    { name: 'Round133 Student', email, password: 'r133-' + stamp, role: 'student' });
  const sId = r.body.person.id;
  await login('s', email, 'r133-' + stamp);
  r = await req('s', 'POST', '/api/auth/change', { current: 'r133-' + stamp, password: 'Chosen-' + stamp + '-ok' });
  await login('s', email, 'Chosen-' + stamp + '-ok');

  const mp = multipart('passport', 'evil\r\nX-Injected: 1.pdf',
    Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(80, 65)]));
  r = await req('s', 'POST', '/api/documents', undefined,
    { raw: mp.data, headers: { 'content-type': mp.type } });
  ok('a document whose name carries a line break is accepted', r.ok, r.status);
  ok('  · with the line break taken out of the name',
    !/[\r\n]/.test(String(((r.body || {}).docs || {}).passport
      ? r.body.docs.passport.name || '' : '')),
    JSON.stringify(((r.body || {}).docs || {}).passport || {}).slice(0, 120));
  const dl = await fetch(BASE + '/api/documents/passport/file', { headers: { cookie: jar.s } });
  ok('  · and it can still be opened afterwards', dl.status === 200, dl.status);

  /* Taking the carriage returns out was half of it. Node refuses every
     character it cannot put in a header, which includes the invisible
     direction marks — the ones that make gnp.exe read as a PDF. The test is
     not a list of bad characters but whether the file comes back. */
  for (const [what, nm] of [
    ['a right-to-left override', '‮gnp.exe‬.pdf'],
    ['a zero-width space', 'pass​port.pdf'],
    ['a byte-order mark', '﻿passport.pdf'],
    ['a C1 control', 'pass\u0085port.pdf'],
    ['nothing but控制 characters', '\u0000\u0001‮.pdf'],
    ['a name in Telugu', 'పాస్‌పోర్ట్.pdf'],
    ['a semicolon', 'my passport; really.pdf'],
  ]) {
    const key = 'other';
    const m2 = multipart(key, nm, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(40, 66)]));
    const up = await req('s', 'POST', '/api/documents', undefined,
      { raw: m2.data, headers: { 'content-type': m2.type } });
    const back = await fetch(BASE + '/api/documents/' + key + '/file', { headers: { cookie: jar.s } });
    ok('a file named with ' + what + ' goes up and comes back',
      up.ok && back.status === 200, 'up ' + up.status + ', down ' + back.status);
  }

  /* ---- 2. a profile that is not a profile ----
     `{"profile":"x"}` replaced the whole record with a string and answered
     ok:true. Nothing threw — reading a field off a string is undefined, not
     an error — so the grade checks found nothing to object to and the
     dashboard was then handed a profile that is not one. */
  r = await req('s', 'PUT', '/api/profile', { profile: 'just a string' });
  ok('a profile that is a string is refused', r.status === 422, r.status);
  r = await req('s', 'PUT', '/api/profile', { profile: ['a'] });
  ok('  · and one that is a list', r.status === 422, r.status);
  r = await req('s', 'PUT', '/api/profile', { profile: { firstName: 'Real', lastName: 'Person' } });
  ok('  · a real one still saves', r.ok, r.status + ' ' + ((r.body || {}).error || ''));
  r = await req('s', 'GET', '/api/state');
  ok('  · and what comes back is an object', r.body && typeof r.body.profile === 'object',
    typeof ((r.body || {}).profile));

  /* ---- 3. somebody else's money ----
     Recording a part payment asked who you were and never whose order it
     was, so any counsellor could mark a part paid on any order in the book —
     and the student was told on their own thread that the money had arrived.
     References are four digits; the whole book could be walked. */
  r = await req('a', 'POST', '/api/staff/people',
    { name: 'Holder ' + stamp, email: 'hold' + stamp + '@glovels.com', password: 'hold-' + stamp, role: 'counsellor' });
  const holder = r.body.person.id;
  r = await req('a', 'POST', '/api/staff/people',
    { name: 'Stranger ' + stamp, email: 'str' + stamp + '@glovels.com', password: 'str-' + stamp, role: 'counsellor' });
  await req('a', 'PUT', '/api/staff/student/' + sId + '/counsellor', { counsellorId: holder });
  await login('x', 'str' + stamp + '@glovels.com', 'str-' + stamp);
  r = await req('x', 'POST', '/api/auth/change', { current: 'str-' + stamp, password: 'Stranger-' + stamp + '-ok' });
  await login('x', 'str' + stamp + '@glovels.com', 'Stranger-' + stamp + '-ok');

  r = await req('s', 'POST', '/api/orders', {
    name: 'Round133 Student', email, phone: '9876500133',
    packageId: 'pkg-boarding', payIn: 'parts', acceptedTerms: true,
  });
  const ref = (r.body || {}).reference;
  if (!ref) {
    ok('an order in parts could be placed', false,
      'STOPPED: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 140)
      + ' (if this is the ten-an-hour limit, restart the server)');
  } else {
    r = await req('x', 'POST', '/api/staff/order/' + ref + '/part', { note: 'not mine to record' });
    ok('a counsellor cannot record money on a student who is not theirs',
      r.status === 403, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
    await login('h', 'hold' + stamp + '@glovels.com', 'hold-' + stamp);
    await req('h', 'POST', '/api/auth/change', { current: 'hold-' + stamp, password: 'Holder-' + stamp + '-ok' });
    await login('h', 'hold' + stamp + '@glovels.com', 'Holder-' + stamp + '-ok');
    r = await req('h', 'POST', '/api/staff/order/' + ref + '/part', { note: 'collected at the desk' });
    ok('  · the counsellor who holds the file can', r.ok, r.status + ' ' + ((r.body || {}).error || ''));
  }

  /* ---- 4. a note written by a request that was refused ----
     The follow-up date was checked last, by which point the note was on the
     record and the lead had already been moved to "contacted". A 422 that
     reads as "nothing happened" had happened, so the counsellor who sensibly
     tried again logged the same call twice. */
  r = await req('a', 'POST', '/api/staff/leads',
    { name: 'Atomic ' + stamp, phone: '9876500134', source: 'phone' });
  const leadId = r.body.lead.id;
  const before = (await req('a', 'GET', '/api/staff/lead/' + leadId)).body;
  r = await req('a', 'POST', '/api/staff/lead/' + leadId + '/note',
    { body: 'called them, no answer', kind: 'call', nextAt: '2000-01-01' });
  ok('a note with an impossible follow-up date is refused', r.status === 422, r.status);
  const after = (await req('a', 'GET', '/api/staff/lead/' + leadId)).body;
  ok('  · and nothing about the lead moved',
    Number((after.lead || {}).followUps || 0) === Number((before.lead || {}).followUps || 0)
    && String((after.lead || {}).status) === String((before.lead || {}).status),
    JSON.stringify({ was: (before.lead || {}).followUps, now: (after.lead || {}).followUps }));
  r = await req('a', 'POST', '/api/staff/lead/' + leadId + '/note',
    { body: 'called them, no answer', kind: 'call', nextAt: day(3) });
  ok('  · a real one records once', r.ok, r.status + ' ' + ((r.body || {}).error || ''));

  /* ---- 4b. somebody else's lead ----
     Reading, editing, noting and converting a lead somebody else owns were
     all refused. Deleting it — and every call ever logged against it — was
     not, and lead ids are small and sequential. */
  await req('a', 'PUT', '/api/staff/lead/' + leadId, { ownerId: holder, status: 'following' });
  r = await req('x', 'DELETE', '/api/staff/lead/' + leadId);
  ok('a counsellor cannot delete a lead that belongs to somebody else',
    r.status === 403, r.status + ' ' + JSON.stringify(r.body).slice(0, 100));
  r = await req('a', 'GET', '/api/staff/lead/' + leadId);
  ok('  · and it is still there', r.ok && r.body.lead, r.status);
  r = await req('a', 'DELETE', '/api/staff/lead/' + leadId);
  ok('  · the office can still delete it', r.ok, r.status);

  /* ---- 5. too big to read, answered rather than hung up on ----
     A body over the limit had its socket destroyed before any route ran, so
     the caller got ECONNRESET: no status, no sentence, nothing a screen can
     put in front of somebody. */
  r = await req('a', 'PUT', '/api/staff/task-rules', undefined,
    { raw: JSON.stringify({ rules: { welcome: { title: 'x'.repeat(200000), sla: 2 } } }) });
  ok('an oversized body is answered, not hung up on',
    r.status === 413, r.status);

  /* ---- 6. what day it is, in the office's own timezone ----
     Between midnight and half past five in the morning in Hyderabad the UTC
     day is still yesterday, so a task dated today was accepted as a date
     already gone — or refused as one. Both from the same line. */
  r = await req('a', 'POST', '/api/staff/student/' + sId + '/tasks',
    { title: 'Due today', due: day(0) });
  const istToday = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  r = await req('a', 'POST', '/api/staff/student/' + sId + '/tasks',
    { title: 'Due today in Hyderabad', due: istToday });
  ok('a task due today in Hyderabad is allowed whatever the hour',
    r.ok, r.status + ' ' + ((r.body || {}).error || ''));
  const madeId = ((r.body || {}).task || {}).id;
  r = await req('a', 'GET', '/api/staff/tasks?state=all');
  const made = (r.body.tasks || []).find(t => Number(t.id) === Number(madeId));
  ok('  · and is not on the late list on the day it was made',
    made && !made.late, JSON.stringify(made || {}).slice(0, 140));

  /* ---- 7. the footer's own link ----
     `href="university"` on a page served at /university/<slug> asks for
     /university/university, which has never existed. Every university page
     carried it. */
  const uniList = await fetch(BASE + '/university');
  const uniHtml = await (await fetch(BASE + '/university/tu-munich')).text();
  ok('the universities page is there', uniList.status === 200, uniList.status);
  ok('  · and a university page links to it without inventing a folder',
    !/href="university"/.test(uniHtml) && /href="\/university"/.test(uniHtml),
    (uniHtml.match(/href="[^"]*university"/g) || []).slice(0, 3).join(' '));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
