/* Patch 272: a batch of translations loaded in one request. */
const BASE = 'http://localhost:8099';
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) pass++; else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
async function j(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/130' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, body: d, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
(async () => {
  const admin = (await j('POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' })).cookie;
  await j('PUT', '/api/staff/i18n', { on: false, langs: ['zh', 'ar'] }, admin);
  for (const p of ['/zh/', '/zh/about-us']) await fetch(BASE + p, { headers: { Cookie: admin, 'User-Agent': 'Mozilla/5.0 Chrome/130' } });
  const list = await j('GET', '/api/staff/i18n/units?lang=zh&status=pending&per=50', null, admin);
  const rows = list.body.rows || [];
  check('there are lines waiting', rows.length >= 10, rows.length);
  const plain = rows.filter(r => !/[<{&]/.test(r.src) && r.kind === 'html').slice(0, 5);
  const withPh = rows.find(r => /\{1\}/.test(r.src));
  const items = plain.map(r => ({ hash: r.hash, text: '中文 ' + r.src }));
  if (withPh) items.push({ hash: withPh.hash, text: '缺少占位符' });
  const skipOne = rows[rows.length - 1].hash;
  const r = await j('POST', '/api/staff/i18n/import', { lang: 'zh', items, skip: [skipOne] }, admin);
  check('the batch saves', r.status === 200 && r.body.saved === plain.length, JSON.stringify(r.body).slice(0, 200));
  check('a line that drops a placeholder is refused, not saved', !withPh || r.body.bad.some(b => b.hash === withPh.hash), JSON.stringify(r.body.bad));
  check('a skip is taken out', r.body.skipped === 1);
  const after = await j('GET', '/api/staff/i18n/units?lang=zh&status=checked&per=200', null, admin);
  check('saved lines are checked', plain.every(p => (after.body.rows || []).some(x => x.hash === p.hash && x.text === '中文 ' + p.src)));
  let page = '';
  for (const u of ['/zh/', '/zh/about-us']) page += await (await fetch(BASE + u, { headers: { Cookie: admin, 'User-Agent': 'Mozilla/5.0 Chrome/130' } })).text();
  check('the preview shows a loaded line straight away', plain.some(p => page.includes('中文 ' + p.src)), plain.map(p => p.page + ':' + p.src.slice(0, 30)).join(' | '));
  const counsellor = (await j('POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' })).cookie;
  const no = await j('POST', '/api/staff/i18n/import', { lang: 'zh', items }, counsellor);
  check('a counsellor cannot load translations', no.status === 403, no.status);
  console.log('i18nimporttest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
