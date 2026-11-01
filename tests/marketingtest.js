/**
 * Patch 204: marketing — where every student came from, and what it cost.
 *
 * Boots its own server (fresh database) beside a mock Google and a mock Meta,
 * then behaves like visitors: one arrives from an Instagram ad (utm tags),
 * one in the Instagram app with no referrer, one from a Google ad (gclid).
 * The ad visitor clicks WhatsApp, searches for something we do not have,
 * and sends an enquiry. Then checks the board credits the lead to the ad and
 * its campaign, the empty search reaches the product team's list, the spend
 * gives a cost per lead, Google keywords and Meta campaigns come through, the
 * cookie cannot be forged, and only the right people can open any of it —
 * including a counsellor who has marketing as well.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = '/home/claude/glovels/build';
const PORT = 8204, MOCK = 8205;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0';

const call = (path, opts) => new Promise(resolve => {
  opts = opts || {};
  const req = http.request({ host: 'localhost', port: PORT, path, method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA }, opts.headers || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  req.end();
});
const login = async (email, pw) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: pw || 'glovels123' } });
  return String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
};
const cookieFrom = r => String([].concat(r.headers['set-cookie'] || []).find(c => /^gl_ft=/.test(c)) || '').split(';')[0];

/* A Google that answers a token and a Search Console query, and a Meta that
   answers the insights the board asks for. */
function mock() {
  return http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      const send = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/token') return send({ access_token: 'tok', expires_in: 3600 });
      if (/searchAnalytics/.test(req.url)) {
        const q = JSON.parse(body || '{}'); const dim = (q.dimensions || [])[0];
        const prev = q.endDate < new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
        if (dim === 'query') return send({ rows: [
          { keys: ['study in germany'], clicks: prev ? 20 : 40, impressions: prev ? 1000 : 2400, ctr: 0.016, position: 7.2 },
          { keys: ['opportunity card germany'], clicks: 3, impressions: prev ? 10 : 600, ctr: 0.005, position: 9.1 },
          { keys: ['glovels'], clicks: 90, impressions: 120, ctr: 0.75, position: 1.0 },
        ] });
        if (dim === 'page') return send({ rows: [{ keys: ['https://glovels.com/study-in-germany'], clicks: 40, impressions: 2400, ctr: 0.016, position: 7.2 }] });
        if (dim === 'country') return send({ rows: [{ keys: ['ind'], clicks: 100, impressions: 3000, ctr: 0.03, position: 6 }] });
        if (dim === 'device') return send({ rows: [{ keys: ['MOBILE'], clicks: 100, impressions: 3000, ctr: 0.03 }] });
        if (dim === 'date') return send({ rows: [{ keys: ['2026-10-20'], clicks: 5, impressions: 100 }] });
        return send({ rows: [] });
      }
      if (/\/insights/.test(req.url)) {
        const u = new URL(req.url, 'http://x');
        const row = { spend: '5000', impressions: '100000', reach: '60000', clicks: '1500', inline_link_clicks: '1200', ctr: '1.2', cpc: '4.17', account_currency: 'INR', actions: [{ action_type: 'lead', value: '12' }] };
        if (u.searchParams.get('breakdowns') === 'publisher_platform') return send({ data: [Object.assign({ publisher_platform: 'instagram' }, row), Object.assign({ publisher_platform: 'facebook' }, row, { spend: '1000' })] });
        if (u.searchParams.get('breakdowns') === 'country') return send({ data: [Object.assign({ country: 'IN' }, row)] });
        if (u.searchParams.get('time_increment')) return send({ data: [{ date_start: new Date().toISOString().slice(0, 10), spend: '6000', impressions: '200000', clicks: '3000' }] });
        return send({ data: [Object.assign({ campaign_name: 'Germany masters — Nov' }, row)] });
      }
      res.writeHead(404); res.end('{}');
    });
  });
}

(async () => {
  const dir = '/tmp/db-marketing-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const m = mock(); await new Promise(r => m.listen(MOCK, r));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = JSON.stringify({ client_email: 'board@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off',
      GSC_SERVICE_ACCOUNT: Buffer.from(key).toString('base64'), GSC_SITE: 'sc-domain:glovels.com',
      GOOGLE_TOKEN_URL: 'http://localhost:' + MOCK + '/token', GSC_API_BASE: 'http://localhost:' + MOCK,
      META_ACCESS_TOKEN: 'meta-test', META_AD_ACCOUNT: 'act_42', META_API_BASE: 'http://localhost:' + MOCK }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }

    /* 1. An Instagram ad. */
    const land = await call('/?utm_source=instagram&utm_medium=paid&utm_campaign=germany-nov', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
    const ft = cookieFrom(land);
    check('an ad visit is given the first-touch cookie', /^gl_ft=[\w-]+\.[\w-]{12}$/.test(ft), ft);
    check('the cookie is HttpOnly and SameSite', /HttpOnly/.test(String(land.headers['set-cookie'])) && /SameSite=Lax/.test(String(land.headers['set-cookie'])));
    const again = await call('/study-in-germany', { headers: { Cookie: ft, 'X-Forwarded-For': '203.0.113.7' } });
    check('a second page does not replace it', !cookieFrom(again));
    /* 2. The Instagram app, no referrer. 3. A Google ad. */
    await call('/study-in-canada', { headers: { 'User-Agent': IG_UA, 'X-Forwarded-For': '203.0.113.8' } });
    await call('/?gclid=abc123', { headers: { 'X-Forwarded-For': '203.0.113.9' } });

    /* The ad visitor clicks WhatsApp, and stays. */
    const t1 = await call('/api/t', { method: 'POST', headers: { Cookie: ft, 'X-Forwarded-For': '203.0.113.7' }, body: { n: 'whatsapp', l: 'WhatsApp', t: 'https://wa.me/91', p: '/' } });
    await call('/api/t', { method: 'POST', headers: { Cookie: ft, 'X-Forwarded-For': '203.0.113.7' }, body: { n: 'engaged', p: '/' } });
    check('the click beacon answers 204', t1.status === 204, String(t1.status));
    const tBad = await call('/api/t', { method: 'POST', body: { n: 'DROP TABLE;' } });
    check('a nonsense event name is dropped quietly', tBad.status === 204);

    /* Searches: one we cannot answer, one we can. */
    await call('/api/find/match?country=DE&q=underwater%20basket%20weaving', { headers: { Cookie: ft, 'X-Forwarded-For': '203.0.113.7' } });
    await call('/api/find/match?country=DE&level=master', { headers: { Cookie: ft, 'X-Forwarded-For': '203.0.113.7' } });
    await call('/api/universities/search?q=zzqxv', { headers: { 'X-Forwarded-For': '203.0.113.7' } });

    /* The lead. */
    const lead = await call('/api/enquiries', { method: 'POST', headers: { Cookie: ft, 'X-Forwarded-For': '203.0.113.7' },
      body: { name: 'Insta Lead', phone: '9876543210', email: 'insta.lead@example.com', consent: 'yes', destination: 'DE' } });
    check('the enquiry is accepted', lead.status === 200, String(lead.status) + JSON.stringify(lead.body));

    /* A forged cookie is ignored. */
    const forged = 'gl_ft=' + Buffer.from(JSON.stringify({ s: 'ads', w: 'Fake', c: 'forged' })).toString('base64url') + '.AAAAAAAAAAAA';
    await call('/api/enquiries', { method: 'POST', headers: { Cookie: forged, 'X-Forwarded-For': '203.0.113.50' },
      body: { name: 'Forged Lead', phone: '9876500000', email: 'forged@example.com', consent: 'yes' } });

    const admin = await login('admin@glovels.com');
    const rep = await call('/api/marketing/report?days=30', { headers: { Cookie: admin } });
    check('the admin gets the board', rep.status === 200, String(rep.status));
    const R = rep.body;
    const ch = name => (R.channels || []).find(c => c.name === name) || {};
    check('the Instagram ad is a channel with its visitor', ch('Instagram Ads').visitors >= 1, JSON.stringify((R.channels || []).map(c => c.name)));
    check('and the lead is credited to it', ch('Instagram Ads').leads === 1, JSON.stringify(ch('Instagram Ads')));
    check('the Instagram app visit is Instagram, not Direct', ch('Instagram').visitors >= 1);
    check('the gclid visit is Google Ads', ch('Google Ads').visitors >= 1);
    check('the forged cookie credited nothing', !(R.campaigns || []).some(c => c.name === 'forged') && !ch('Fake Ads').leads);
    check('the campaign has its visitor and lead', ((R.campaigns || []).find(c => c.name === 'germany-nov') || {}).leads === 1);
    check('the WhatsApp click is counted', (R.clickKinds || []).some(k => k.name === 'whatsapp'));
    check('and the visitor counts as engaged', R.totals.engaged >= 1);
    check('the funnel runs visitors → paid', (R.funnel || []).length === 6 && R.funnel[0].n >= 3);
    check('pages people open are listed by section', (R.pages || []).some(p => p.path === '/study-in-germany' && p.section === 'Destination pages'));
    check('searches are counted', R.searches.total >= 2, String(R.searches.total));
    check('the empty search is listed as finding nothing', R.searches.noResults.some(g => /underwater basket/.test(g.q)));
    check('the quick search that found nothing is too', R.searches.noResults.some(g => g.q === 'zzqxv'));
    check('the search that found programmes is not', !R.searches.noResults.some(g => !g.q && g.level === 'master'));

    /* Filters. */
    const only = await call('/api/marketing/report?days=30&channel=' + encodeURIComponent('Instagram Ads'), { headers: { Cookie: admin } });
    check('filtering to one channel narrows the totals', only.body.totals.visitors >= 1 && only.body.totals.visitors < R.totals.visitors && only.body.totals.leads === 1,
      only.body.totals.visitors + ' of ' + R.totals.visitors);

    /* Spend → cost per lead. */
    const sp = await call('/api/marketing/spend', { method: 'POST', headers: { Cookie: admin },
      body: { month: new Date().toISOString().slice(0, 7), channel: 'Instagram Ads', amount: '31000', currency: 'INR', campaign: 'germany-nov' } });
    check('spend can be added', sp.status === 201, JSON.stringify(sp.body));
    const badSp = await call('/api/marketing/spend', { method: 'POST', headers: { Cookie: admin }, body: { month: 'soon', channel: 'x', amount: 1 } });
    check('a spend with no month is refused', badSp.status === 422);
    const rep2 = (await call('/api/marketing/report?days=30', { headers: { Cookie: admin } })).body;
    const ig2 = rep2.channels.find(c => c.name === 'Instagram Ads') || {};
    check('the channel now has spend and a cost per lead', ig2.spend > 0 && ig2.cpl === ig2.spend, JSON.stringify(ig2));

    /* The product team's list. */
    const gaps = await call('/api/product/gaps', { headers: { Cookie: admin } });
    const g = (gaps.body.items || []).find(x => /underwater/.test(x.q));
    check('the missing programme reaches the product list', !!g && g.status === 'new', JSON.stringify(gaps.body).slice(0, 200));
    const setG = g && await call('/api/product/gaps', { method: 'PUT', headers: { Cookie: admin }, body: { key: g.key, status: 'partner', note: 'asking a partner' } });
    const gaps2 = await call('/api/product/gaps', { headers: { Cookie: admin } });
    check('and can be marked "seeking a partnership"', setG && setG.status === 200 && (gaps2.body.items.find(x => x.key === g.key) || {}).status === 'partner');

    /* Google and Meta. */
    const seo = (await call('/api/marketing/seo?days=28', { headers: { Cookie: admin } })).body;
    check('Search Console keywords come through', seo.connected && (seo.keywords || []).some(k => k.q === 'study in germany'), JSON.stringify(seo).slice(0, 160));
    check('a keyword shown far more than before is trending', (seo.rising || []).some(k => k.q === 'opportunity card germany'));
    check('a much-seen, little-clicked keyword is a quick win', (seo.opportunities || []).some(k => k.q === 'study in germany'));
    const meta = (await call('/api/marketing/meta?days=30', { headers: { Cookie: admin } })).body;
    check('Meta splits Facebook and Instagram', meta.connected && (meta.platforms || []).map(p => p.name).sort().join() === 'Facebook,Instagram', JSON.stringify(meta).slice(0, 160));
    const spendRows = (await call('/api/marketing/spend', { headers: { Cookie: admin } })).body.rows || [];
    check('Meta spend is booked into the spend list once', spendRows.filter(r => r.source === 'meta').length === 2);
    await call('/api/marketing/meta?days=30&refresh=1', { headers: { Cookie: admin } });
    check('and not twice on a refresh', ((await call('/api/marketing/spend', { headers: { Cookie: admin } })).body.rows || []).filter(r => r.source === 'meta').length === 2);

    /* Who may see it. */
    const kavya = await login('kavya@glovels.com');
    check('a counsellor without marketing is refused', (await call('/api/marketing/report', { headers: { Cookie: kavya } })).status === 403);
    const student = await login('student@glovels.com');
    check('a student is refused', [401, 403].includes((await call('/api/marketing/report', { headers: { Cookie: student } })).status));
    check('nobody signed in is refused', [401, 403].includes((await call('/api/marketing/report')).status));
    const people = (await call('/api/staff/people', { headers: { Cookie: admin } })).body;
    const kv = (people.people || people.staff || people || []).find ? (people.people || people.staff || people).find(p => /kavya/i.test(p.email)) : null;
    const giveK = kv && await call('/api/staff/people/' + kv.id + '/perms', { method: 'PUT', headers: { Cookie: admin }, body: { perms: ['marketing'] } });
    check('a counsellor can be given marketing as well', giveK && giveK.status === 200);
    check('and then opens the board', (await call('/api/marketing/report', { headers: { Cookie: kavya } })).status === 200);
    check('while still a counsellor with their students', (await call('/api/staff/command', { headers: { Cookie: kavya } })).status === 200);

    const mk = await call('/api/staff/people', { method: 'POST', headers: { Cookie: admin },
      body: { name: 'Maya Marketing', email: 'maya.mkt@example.com', role: 'editor', perms: ['marketing'], password: 'a-strong-password-204' } });
    check('a marketing-only person can be added', [200, 201].includes(mk.status), JSON.stringify(mk.body).slice(0, 160));
    const people2 = (await call('/api/staff/people', { headers: { Cookie: admin } })).body;
    const list2 = people2.people || people2.staff || people2;
    const maya = Array.isArray(list2) ? list2.find(p => p.email === 'maya.mkt@example.com') : null;
    check('and shows as "Marketing" on the team', maya && maya.level === 'marketing', maya && maya.level);

    /* The page. */
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', x => { if (x.type() === 'error' && !/fonts\.g/.test(x.text())) errs.push(x.text()); });
    await p.goto('http://localhost:' + PORT + '/marketing'); await p.waitForTimeout(1500);
    check('/marketing draws with no script errors', errs.length === 0, errs.join(' | '));
    check('eight KPI tiles', (await p.$$('#kpis .kpi')).length === 8);
    check('a trend line is drawn', !!(await p.$('#chart path.ln')));
    await p.screenshot({ path: '/tmp/mkt-top.png' });
    await p.click('#kpis .kpi[data-metric="leads"]'); await p.waitForTimeout(200);
    check('a tile changes the chart', /Leads per day/.test(await p.textContent('#chartH')));
    await p.click('tr[data-channel="Instagram Ads"]'); await p.waitForTimeout(900);
    check('a channel row narrows the board to it', /Instagram Ads/.test(await p.textContent('#chips')));
    await p.click('[data-clear="channel"]'); await p.waitForTimeout(900);
    await p.click('#tabs [data-tab="gaps"]'); await p.waitForTimeout(900);
    check('the missing-programmes tab lists the search with a status', /underwater basket weaving/.test(await p.textContent('#pane')) && !!(await p.$('#pane select.gapsel')));
    await p.screenshot({ path: '/tmp/mkt-gaps.png' });
    await p.click('#tabs [data-tab="seo"]'); await p.waitForTimeout(1200);
    check('the Google keywords tab shows keywords', /study in germany/.test(await p.textContent('#pane')));
    await p.screenshot({ path: '/tmp/mkt-seo.png', fullPage: true });
    await p.click('#tabs [data-tab="pages"]'); await p.waitForTimeout(400);
    check('the pages tab lists the pages opened', /study-in-germany/.test(await p.textContent('#pane')));
    await p.click('#tabs [data-tab="meta"]'); await p.waitForTimeout(1200);
    check('the Facebook & Instagram tab shows the campaign', /Germany masters/.test(await p.textContent('#pane')));
    check('still no script errors', errs.length === 0, errs.join(' | '));

    /* A public page carries the tracker, and a real click reaches the server. */
    const pub = await b.newContext({ userAgent: UA });
    const pp = await pub.newPage();
    await pp.goto('http://localhost:' + PORT + '/study-in-germany'); await pp.waitForTimeout(800);
    check('public pages carry the click tracker', await pp.evaluate(() => typeof window.glvTrack === 'function'));
    const sentP = pp.waitForRequest(r => r.url().endsWith('/api/t'), { timeout: 4000 }).then(() => true).catch(() => false);
    await pp.evaluate(() => { const a = document.createElement('a'); a.href = 'tel:+911234'; a.textContent = 'Call us'; document.body.appendChild(a); a.addEventListener('click', e => e.preventDefault()); a.click(); });
    check('a click on the page is sent to the server', await sentP);
    await b.close();

    const robots = await call('/robots.txt');
    check('/marketing is kept out of search', /Disallow: \/marketing/.test(robots.body.raw || '') || /'Disallow: \/marketing'/.test(fs.readFileSync(ROOT + '/serve.js', 'utf8')));
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
    m.close();
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nmarketingtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
