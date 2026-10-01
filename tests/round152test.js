/*
 * Patch 152 — 1 Oct decisions.
 *  - Every private university is free to apply ("all private unis should be free to apply").
 *  - The four one-paragraph original blog pages hand over (301) to the full
 *    articles once those are published; until then the original still serves.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
(async () => {
  const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }) });
  const ck = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const H = { cookie: ck, origin: BASE, 'content-type': 'application/json' };
  const call = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' }); return { s: r.status, j: await r.json().catch(() => ({})), loc: r.headers.get('location') }; };

  const S = Date.now();
  let r = await call('PUT', '/api/staff/programme', { program: 'Private Check ' + S, university: 'Privat Hochschule Check', city: 'Berlin',
    country: 'DE', level: 'master', field: 'Computer Science & IT', isPublic: false, feeModel: 'package', totalInr: 1500000 });
  const saved = r.j.programme || r.j;
  ok(r.s === 200 && saved.feeModel === 'free', 'a private programme saved as Package is stored as free to apply — ' + r.s + ' ' + JSON.stringify(saved).slice(0, 120));

  /* Fresh database: the replacement article is a draft, so the original serves. */
  r = await call('GET', '/post/german-universities-lower-cgpa');
  ok(r.s === 200, 'with the full article unpublished the original page still serves — ' + r.s);

  /* Publish a post at the replacement slug and the original hands over. */
  r = await call('POST', '/api/staff/posts', { title: 'German public universities with a low CGPA', slug: 'german-public-universities-low-cgpa',
    body: 'Full article. '.repeat(80), status: 'published', excerpt: 'x', tag: 'Germany' });
  const pub = await fetch(BASE + '/post/german-public-universities-low-cgpa');
  if (pub.status === 200) {
    const red = await fetch(BASE + '/post/german-universities-lower-cgpa', { redirect: 'manual' });
    ok(red.status === 301 && /german-public-universities-low-cgpa/.test(red.headers.get('location') || ''), 'once it is published the original 301s to it — ' + red.status + ' ' + red.headers.get('location'));
    const idx = await (await fetch(BASE + '/blog')).text();
    ok(!/post\/german-universities-lower-cgpa/.test(idx), 'and the blog index no longer lists the original');
  } else {
    ok(false, 'could not publish a post to test the redirect — ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 120));
  }
  console.log('round152test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
