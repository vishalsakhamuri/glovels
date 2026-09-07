/**
 * The office's accounts, in the footer of every page — and hidden from it.
 *
 * An administrator saves an Instagram and a Facebook link with Show ticked
 * and a LinkedIn one without; every public page then carries exactly those
 * two, the home page names them in its structured data, the portal carries
 * none, and unticking takes them off again. A link that is not on that
 * network's own site is refused rather than published.
 *
 *   ./tests/srv.sh 8099
 *   node tests/socialtest.js
 */
const BASE = process.env.BASE || 'http://localhost:8099';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@glovels.com', password: process.env.ADMIN_PASSWORD || 'glovels123' };
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const j = (method, p, body, cookie) => fetch(BASE + p, {
  method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: body === undefined ? undefined : JSON.stringify(body),
});
const page = async p => (await fetch(BASE + p)).text();
const links = html => [...html.matchAll(/<a href="([^"]+)"[^>]*aria-label="Glovels on ([^"]+)"/g)].map(m => [m[2], m[1]]);

(async () => {
  let r = await j('POST', '/api/auth/login', ADMIN);
  const admin = (r.headers.get('set-cookie') || '').split(';')[0];
  check('the administrator signs in', r.status === 200, String(r.status));

  r = await j('GET', '/api/staff/content', undefined, admin);
  const finder = (await r.json()).finder || {};
  check('the finder settings list every network with a switch',
    Array.isArray(finder.social) && finder.social.some(x => x.id === 'instagram') && finder.social.every(x => 'show' in x && 'url' in x),
    JSON.stringify((finder.social || []).map(x => x.id)));

  /* Nothing shown yet: the home page's placeholder icons are gone, and no
     other page has a row. */
  let html = await page('/');
  check('with nothing saved, the home page shows no social links', links(html).length === 0, JSON.stringify(links(html)));

  const save = async social => {
    const r = await j('PUT', '/api/staff/content/finder', { value: Object.assign({}, finder, { social }) }, admin);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  let out = await save([
    { id: 'instagram', url: 'https://www.instagram.com/glovels.test/', show: true },
    { id: 'facebook', url: 'https://www.facebook.com/glovelstest', show: true },
    { id: 'linkedin', url: 'https://www.linkedin.com/company/glovels-test/', show: false },
    { id: 'youtube', url: 'https://evil.example/not-youtube', show: true },
  ]);
  check('the links save', out.status === 200, JSON.stringify(out.body).slice(0, 120));
  const saved = (out.body.saved || {}).social || [];
  check('a link that is not on the network\'s own site is refused', saved.find(x => x.id === 'youtube').url === '' && !saved.find(x => x.id === 'youtube').show);
  check('the hidden one keeps its link', saved.find(x => x.id === 'linkedin').url.includes('linkedin.com') && !saved.find(x => x.id === 'linkedin').show);

  for (const p of ['/', '/contact-us', '/study-in-germany', '/blog']) {
    html = await page(p);
    const l = links(html);
    check(p + ' shows Instagram and Facebook and nothing else',
      l.length === 2 && l.some(x => x[0] === 'Instagram' && x[1].includes('glovels.test')) && l.some(x => x[0] === 'Facebook'),
      JSON.stringify(l));
    check(p + ' puts them in the footer', html.lastIndexOf('data-socials') > html.lastIndexOf('<footer'));
  }
  html = await page('/');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const org = ld.find(x => x['@type'] === 'Organization');
  check('the home page names the shown accounts in its structured data',
    org && org.sameAs.length === 2 && org.sameAs.some(u => u.includes('instagram')), JSON.stringify(org && org.sameAs));
  check('and not the hidden one', org && !org.sameAs.some(u => u.includes('linkedin')));
  html = await (await fetch(BASE + '/dashboard')).text();
  check('the portal carries none', links(html).length === 0);
  html = await (await fetch(BASE + '/admin', { headers: { Cookie: admin } })).text();
  check('nor does the office', links(html).length === 0);

  out = await save(saved.map(x => Object.assign({}, x, { show: false })));
  html = await page('/contact-us');
  check('unticking every switch takes the row off the next page', out.status === 200 && links(html).length === 0, JSON.stringify(links(html)));
  html = await page('/');
  check('and the home page too', links(html).length === 0 && !/"sameAs"/.test(html));

  /* The office screen has the editor. */
  html = await (await fetch(BASE + '/home', { headers: { Cookie: admin } })).text();
  check('the Home page screen has the Social links editor', /id="fSocial"/.test(html) && /function paintSocial/.test(html));

  console.log('\n' + ok.map(x => '  ✓ ' + x).join('\n'));
  if (bad.length) console.log('\n' + bad.map(x => '  ✗ ' + x).join('\n'));
  console.log('\n  ' + ok.length + ' passed, ' + bad.length + ' failed\n');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
