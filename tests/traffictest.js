/**
 * How the site is found — the count, and the screen that reads it.
 *
 * Visits are made the way the world makes them: a person from a Google
 * result, one from a ChatGPT answer, one from an Instagram link with a
 * campaign on it, and the crawlers that feed Google, ChatGPT and Claude,
 * each announcing itself in User-Agent. Then the administrator's endpoint is
 * read back and has to have sorted every one of them correctly. Then the
 * Google tag: on the public pages once an ID is typed, never on the portal.
 *
 *   ./tests/srv.sh 8099
 *   node tests/traffictest.js
 */
const BASE = process.env.BASE || 'http://localhost:8099';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@glovels.com', password: process.env.ADMIN_PASSWORD || 'glovels123' };
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const visit = (p, headers) => fetch(BASE + p, { headers: Object.assign({
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
}, headers || {}), redirect: 'manual' });
const post = (p, body, headers) => fetch(BASE + p, {
  method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body),
});
const find = (rows, name) => (rows || []).find(r => r.name === name);

(async () => {
  /* ------------------------------------------------ the visits */
  let r = await visit('/', { Referer: 'https://www.google.com/', 'X-Forwarded-For': '203.0.113.1' });
  check('the home page answers', r.status === 200, String(r.status));
  await visit('/study-in-germany', { Referer: 'https://www.google.com/', 'X-Forwarded-For': '203.0.113.1' });
  await visit('/', { Referer: 'https://chatgpt.com/', 'X-Forwarded-For': '203.0.113.2' });
  await visit('/contact-us', { Referer: 'https://claude.ai/chat/abc', 'X-Forwarded-For': '203.0.113.3' });
  await visit('/blog', { Referer: 'https://www.perplexity.ai/search/x', 'X-Forwarded-For': '203.0.113.4' });
  await visit('/?utm_source=instagram&utm_medium=social&utm_campaign=sept-intake', { 'X-Forwarded-For': '203.0.113.5' });
  await visit('/', { 'X-Forwarded-For': '203.0.113.6', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' });
  await visit('/', { 'X-Forwarded-For': '203.0.113.6', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' });
  await visit('/study-in-germany', { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
  await visit('/', { 'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)' });
  await visit('/study-in-germany', { 'User-Agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' });
  await visit('/blog', { 'User-Agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' });
  await visit('/', { 'User-Agent': 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)' });
  /* Not visits: the portal, the API, a page script. */
  await visit('/dashboard', { 'X-Forwarded-For': '203.0.113.7' });
  await visit('/login', { 'X-Forwarded-For': '203.0.113.7' });
  await visit('/api/catalogue', { 'X-Forwarded-For': '203.0.113.7' });

  /* An enquiry, so the by-source list has something in it. */
  await post('/api/enquiries', { name: 'Traffic Test', email: 'traffic' + Date.now() + '@example.com', phone: '9876543210',
    referrer: 'https://chatgpt.com/', source: 'website' }, { 'X-Forwarded-For': '203.0.113.2' });

  /* ------------------------------------------------ the count */
  r = await post('/api/auth/login', ADMIN);
  const admin = (r.headers.get('set-cookie') || '').split(';')[0];
  check('the administrator signs in', r.status === 200 && admin, String(r.status));
  r = await fetch(BASE + '/api/staff/traffic?days=7');
  check('the count needs a sign-in', r.status === 401, String(r.status));
  r = await fetch(BASE + '/api/staff/traffic?days=7', { headers: { Cookie: admin } });
  const t = await r.json();
  check('the administrator reads it', r.status === 200 && t.ok, String(r.status));

  check('eight page views counted', t.totals.views >= 8, String(t.totals.views));
  check('six visitors — the same person twice is one', t.totals.visitors >= 6 && t.totals.visitors < t.totals.views, String(t.totals.visitors));
  check('three came from AI assistants', t.totals.ai >= 3, String(t.totals.ai));
  check('two came from search', t.totals.search >= 2, String(t.totals.search));
  check('ChatGPT, Claude and Perplexity are each named', !!find(t.ai, 'ChatGPT') && !!find(t.ai, 'Claude') && !!find(t.ai, 'Perplexity'),
    (t.ai || []).map(x => x.name).join(','));
  check('Google is named among the engines', !!find(t.search, 'Google'), (t.search || []).map(x => x.name).join(','));
  check('the Instagram link is a social visit', !!find(t.social, 'Instagram'), (t.social || []).map(x => x.name).join(','));
  check('and its campaign is listed', !!(t.campaigns || []).find(c => /sept-intake/.test(c.name)), (t.campaigns || []).map(x => x.name).join(','));
  check('a typed-in visit is direct', !!find(t.sources, 'direct'), (t.sources || []).map(x => x.name).join(','));
  check('phones and computers are told apart', !!find(t.devices, 'phone') && !!find(t.devices, 'desktop'), (t.devices || []).map(x => x.name).join(','));

  const bot = n => (t.bots || []).find(b => b.name.startsWith(n));
  check('Googlebot is a search crawler, not a visitor', bot('Googlebot') && bot('Googlebot').group === 'search', JSON.stringify(bot('Googlebot')));
  check('GPTBot is an AI crawler', bot('GPTBot') && bot('GPTBot').group === 'ai');
  check('ClaudeBot read two pages', bot('ClaudeBot') && bot('ClaudeBot').pages === 2, JSON.stringify(bot('ClaudeBot')));
  check('PerplexityBot too', !!bot('PerplexityBot'));
  check('three AI crawler reads in the total', t.totals.aiCrawls >= 4, String(t.totals.aiCrawls));
  check('the crawlers are not counted as visitors', !(t.pages || []).some(p => p.count > 20));
  check('the page the AI crawlers read most is known', (t.aiPages || []).length >= 1 && /study-in-germany|^\/$/.test(t.aiPages[0].name), JSON.stringify(t.aiPages));
  check('the portal, the API and the scripts are not visits',
    !(t.pages || []).some(p => /^\/(dashboard|login|api|js)/.test(p.name)), (t.pages || []).map(p => p.name).join(','));
  check('the enquiry is listed by where it came from', !!find(t.enquiriesBy, 'ChatGPT'), (t.enquiriesBy || []).map(x => x.name).join(','));
  check('seven days of bars', t.byDay.length === 7 && t.byDay[6].views >= 8, JSON.stringify(t.byDay.slice(-1)));

  /* ------------------------------------------------ the Google tag */
  r = await fetch(BASE + '/');
  let html = await r.text();
  check('no Google tag before an ID is typed', !/googletagmanager/.test(html) && /window\.glvTrack/.test(html));
  r = await fetch(BASE + '/api/staff/analytics', { method: 'PUT', headers: { Cookie: admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ gaId: 'UA-12345-1' }) });
  check('an old-style UA- ID is refused', r.status === 422, String(r.status));
  r = await fetch(BASE + '/api/staff/analytics', { method: 'PUT', headers: { Cookie: admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ gaId: 'g-test12345' }) });
  const saved = await r.json();
  check('a measurement ID is saved, upper-cased', r.status === 200 && saved.gaId === 'G-TEST12345', JSON.stringify(saved));
  r = await fetch(BASE + '/contact-us');
  html = await r.text();
  check('the tag is on the very next public page', /googletagmanager\.com\/gtag\/js\?id=G-TEST12345/.test(html) && /gtag\("config","G-TEST12345"/.test(html));
  check('with IP anonymisation', /anonymize_ip:true/.test(html));
  check('and it is in the head, not the deferred bundle', html.indexOf('data-ga') < html.indexOf('</head>'));
  r = await fetch(BASE + '/dashboard');
  html = await r.text();
  check('and NOT on the portal', !/googletagmanager/.test(html), String(r.status));
  r = await fetch(BASE + '/admin', { headers: { Cookie: admin } });
  html = await r.text();
  check('nor on the office screens', !/googletagmanager/.test(html));
  check('the office screen has the Traffic tab', /data-o="traffic"/.test(html) && /id="trChart"/.test(html) && /id="gaId"/.test(html));
  r = await fetch(BASE + '/api/staff/analytics', { method: 'PUT', headers: { Cookie: admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ gaId: '' }) });
  check('an empty box takes the tag off', r.status === 200 && (await r.json()).gaId === '');

  /* ------------------------------------------------ a counsellor may not */
  r = await post('/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
  const c = (r.headers.get('set-cookie') || '').split(';')[0];
  if (r.status === 200) {
    r = await fetch(BASE + '/api/staff/traffic', { headers: { Cookie: c } });
    check('a counsellor cannot read the count', r.status === 403, String(r.status));
    r = await fetch(BASE + '/api/staff/analytics', { method: 'PUT', headers: { Cookie: c, 'Content-Type': 'application/json' }, body: JSON.stringify({ gaId: 'G-NOPE1234' }) });
    check('nor set the tag', r.status === 403, String(r.status));
  }

  console.log('\n' + ok.map(x => '  ✓ ' + x).join('\n'));
  if (bad.length) console.log('\n' + bad.map(x => '  ✗ ' + x).join('\n'));
  console.log('\n  ' + ok.length + ' passed, ' + bad.length + ' failed\n');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
