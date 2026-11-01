/**
 * Patch 212: publish once, everywhere — and the weekly news desk.
 * A mock Meta (Facebook Page + Instagram) and a mock writing service stand in
 * for the real ones.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8212, MOCK = 8213;
const BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const jar = {};
async function req(who, method, path, body) {
  const h = { 'content-type': 'application/json' };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j };
}
const seen = [];
const POSTS = [1, 2, 3].map(i => ({ title: 'Germany student visa change ' + i, metaTitle: 'Visa change ' + i, metaDesc: 'What changed for student visas, week ' + i,
  keywords: 'germany visa, student visa, blocked account', tag: 'Visa', excerpt: 'A change to the German student visa. What to do now.',
  body: '## What changed\nThe rule changed.\n\n## What to do now\n1. Check the amount.\n2. Book an appointment.\n\n### Does this affect me?\nIf you apply after the date, yes.',
  sources: ['https://www.auswaertiges-amt.de/en/visa-service'] }));

function mock() {
  return http.createServer((rq, rs) => {
    let body = ''; rq.on('data', c => { body += c; }); rq.on('end', () => {
      seen.push({ url: rq.url, body });
      const send = o => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
      if (/\/v1\/messages$/.test(rq.url)) return send({ content: [{ type: 'text', text: 'Here they are:\n' + JSON.stringify(POSTS) }] });
      if (/\/feed$/.test(rq.url)) return send({ id: 'page_123_post_' + seen.length });
      if (/\/media$/.test(rq.url)) return send({ id: 'container_' + seen.length });
      if (/\/media_publish$/.test(rq.url)) return send({ id: 'ig_' + seen.length });
      rs.writeHead(404); rs.end('{}');
    });
  });
}

(async () => {
  const dir = '/tmp/db-publish-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const m = mock(); await new Promise(r => m.listen(MOCK, r));
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off',
      META_API_BASE: 'http://localhost:' + MOCK, META_PAGE_ID: 'page_123', META_PAGE_TOKEN: 'tok', META_IG_USER: 'ig_9',
      ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_API_BASE: 'http://localhost:' + MOCK }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) {} }
    await req('admin', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });

    const st = (await req('admin', 'GET', '/api/staff/social')).body;
    check('Facebook and Instagram show as connected', st.channels.facebook.connected && st.channels.instagram.connected);

    const live = await req('admin', 'POST', '/api/staff/posts', { title: 'Blocked account amount for 2027', status: 'published',
      body: '## The new amount\nIt goes up from January.', excerpt: 'The blocked account goes up in January.', cover: 'https://images.example.com/cover.jpg', keywords: 'blocked account, germany' });
    check('a post is published on the website', live.ok && live.body.post.status === 'published', JSON.stringify(live.body).slice(0, 120));
    const pid = live.body.post.id;
    const sh = await req('admin', 'POST', '/api/staff/post/' + pid + '/share', { facebook: true, instagram: true, push: true });
    check('it is shared to Facebook, Instagram and push in one go (push says plainly when nobody has notifications on)', sh.ok && sh.body.results.facebook.ok && sh.body.results.instagram.ok && (sh.body.results.push.ok || /Nobody has notifications/.test(sh.body.results.push.error)), JSON.stringify(sh.body));
    const fb = seen.find(x => /\/page_123\/feed$/.test(x.url));
    check('Facebook got the headline and the link to the post', fb && /Blocked\+account/.test(fb.body) && /post%2Fblocked-account-amount-for-2027/.test(fb.body), fb && fb.body.slice(0, 200));
    const ig = seen.find(x => /\/ig_9\/media$/.test(x.url));
    check('Instagram got the cover picture and a caption', ig && /images.example.com%2Fcover.jpg/.test(ig.body) && /link\+in\+our\+bio/.test(ig.body));
    check('and was published', seen.some(x => /\/ig_9\/media_publish$/.test(x.url)));
    const st2 = (await req('admin', 'GET', '/api/staff/social')).body;
    check('the screen remembers where it went', st2.shares[pid] && st2.shares[pid].facebook.ok && st2.shares[pid].instagram.ok);

    const draft = await req('admin', 'POST', '/api/staff/posts', { title: 'Not yet', status: 'draft', body: 'x' });
    check('a draft cannot be shared', (await req('admin', 'POST', '/api/staff/post/' + draft.body.post.id + '/share', { facebook: true })).status === 409);
    const plain = await req('admin', 'POST', '/api/staff/posts', { title: 'No picture post', status: 'published', body: '## Hi\nWords.' });
    const igNo = await req('admin', 'POST', '/api/staff/post/' + plain.body.post.id + '/share', { instagram: true });
    check('Instagram without a picture says so', igNo.ok && !igNo.body.results.instagram.ok && /picture/.test(igNo.body.results.instagram.error));
    await req('kav', 'POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' });
    check('a counsellor cannot share', (await req('kav', 'POST', '/api/staff/post/' + pid + '/share', { facebook: true })).status === 403);

    /* The news desk: drafts first. */
    const nd0 = (await req('admin', 'GET', '/api/staff/newsdesk')).body;
    check('the news desk is on, auto-publish off by default', nd0.connected && nd0.on && nd0.auto === false && nd0.perWeek === 3);
    const run1 = await req('admin', 'POST', '/api/staff/newsdesk/run');
    check('it writes three posts', run1.ok && run1.body.posts.length === 3, JSON.stringify(run1.body).slice(0, 200));
    check('as drafts when auto-publish is off', run1.body.posts.every(p => p.status === 'draft'));
    const ask = seen.find(x => /\/v1\/messages$/.test(x.url));
    check('it asked with web search, and told the writer the rules', ask && /web_search/.test(ask.body) && /Every fact, figure and date must come from a page you actually opened/.test(ask.body));
    const one = (await req('admin', 'GET', '/api/staff/post/' + run1.body.posts[0].id)).body.post;
    check('each post carries its sources', /## Sources/.test(one.body) && /auswaertiges-amt/.test(one.body));

    /* Auto-publish on, and share to Facebook. */
    const set = await req('admin', 'PUT', '/api/staff/newsdesk', { auto: true, share: { facebook: true, instagram: false, push: true } });
    check('auto-publish can be switched on', set.ok && set.body.auto === true && set.body.share.facebook === true);
    const before = seen.filter(x => /\/feed$/.test(x.url)).length;
    const run2 = await req('admin', 'POST', '/api/staff/newsdesk/run');
    check('with auto-publish on the posts go live', run2.ok && run2.body.posts.every(p => p.status === 'published'), JSON.stringify(run2.body).slice(0, 200));
    check('and are shared to Facebook', seen.filter(x => /\/feed$/.test(x.url)).length - before === 3);
    check('without repeating a slug', new Set(run2.body.posts.map(p => p.slug).concat(run1.body.posts.map(p => p.slug))).size === 6);
    const pub = await fetch(BASE + '/post/' + run2.body.posts[0].slug);
    check('and are on the website', pub.status === 200);
    check('a counsellor cannot change the news desk', (await req('kav', 'PUT', '/api/staff/newsdesk', { auto: false })).status === 403);

    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
    await ctx.addCookies(jar.admin.split('; ').map(c => ({ name: c.split('=')[0], value: c.split('=').slice(1).join('='), url: BASE })));
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + '/blog-admin', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
    check('the Blog screen shows the news desk with auto-publish', await p.isVisible('#newsDesk') && await p.isChecked('#ndAuto'));
    await p.locator('#newsDesk').screenshot({ path: '/tmp/newsdesk.png' });
    await p.evaluate(id => open_(id), pid); await p.waitForTimeout(1200);
    check('a live post shows where it was shared', /Share this post/.test(await p.textContent('#shareBox')) && /shared/.test(await p.textContent('#shareBox')));
    await p.locator('#shareBox').screenshot({ path: '/tmp/sharebox.png' });
    check('no script errors', errs.length === 0, errs.join(' | '));
    await b.close();
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
    m.close();
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\npublishtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
