/**
 * Patch 283: the team checklist of 7 Nov 2026 (13 items) and the blog tools.
 * Run against a server on PORT (default 8099) started with GUARD=off.
 */
const { chromium } = require('playwright');
const http = require('http');

const PORT = Number(process.env.PORT || 8099);
const BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

function call(p, o) {
  o = o || {};
  return new Promise(resolve => {
    const headers = Object.assign({ 'User-Agent': 'Mozilla/5.0 Chrome/130.0', 'Content-Type': 'application/json' }, o.headers || {});
    if (o.cookie) headers.Cookie = o.cookie;
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: o.method || 'GET', headers }, res => {
      let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
        let j = {}; try { j = JSON.parse(out); } catch (e) { j = {}; }
        resolve({ status: res.statusCode, body: j, text: out, headers: res.headers });
      });
    });
    req.on('error', () => resolve({ status: 0, body: {}, text: '' }));
    if (o.body) req.write(JSON.stringify(o.body));
    req.end();
  });
}

(async () => {
  let browser;
  try {
    const lg = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@glovels.com', password: 'glovels123' } });
    const staff = String([].concat(lg.headers['set-cookie'] || [])[0] || '').split(';')[0];
    check('admin signs in', lg.status === 200 && !!staff);

    /* 7 WhatsApp */
    const home = await call('/');
    check('7 home page uses +91 70933 14089', home.text.includes('917093314089') && !home.text.includes('91' + '7839399999'));
    const contact = await call('/contact-us');
    check('7 contact page uses the new number', contact.text.includes('70933 14089') && !/78393|7839399999/.test(contact.text));
    const fin = (await call('/api/staff/content', { cookie: staff })).body;
    const finder = (fin.content && fin.content.finder) || fin.finder || null;
    if (finder) {
      const changed = JSON.parse(JSON.stringify(finder));
      changed.contact = Object.assign({}, changed.contact, { whatsapp: '919812345678', phone: '+919812345678' });
      const put = await call('/api/staff/content/finder', { method: 'PUT', cookie: staff, body: changed });
      const home2 = await call('/');
      check('7 the number is one setting: change it and every page follows', put.status === 200 && home2.text.includes('919812345678') && !home2.text.includes('917093314089'), String(put.status));
      await call('/api/staff/content/finder', { method: 'PUT', cookie: staff, body: Object.assign({}, finder, { contact: Object.assign({}, finder.contact, { whatsapp: '917093314089', phone: '+917093314089' }) }) });
    } else check('7 the number is one setting', false, 'finder content not found: ' + Object.keys(fin).join(','));

    /* 8 favicon */
    const ico = await call('/favicon.ico');
    check('8 favicon is served', ico.status === 200);
    const apple = await call('/apple-touch-icon.png');
    check('8 apple touch icon is served', apple.status === 200);

    /* 1 logo */
    const idx = await call('/index.html');
    check('1 /index.html sends to / permanently', idx.status === 301 && idx.headers.location === '/', idx.status + ' ' + idx.headers.location);
    const find = await call('/find-university');
    check('1 Find University logo goes to /', /<a class="logo" href="\/"/.test(find.text) && !/href="(\.\.\/)?index\.html/.test(find.text));
    check('1 no page links to index.html', !/href="(\.\.\/|\/)?index\.html/.test(home.text + contact.text));

    /* 2, 3 analytics */
    const mk = await call('/marketing', { cookie: staff });
    check('2 the page is called Analytics', /<h1>Analytics<\/h1>/.test(mk.text) && /Analytics<\/a>/.test(mk.text));
    check('3 a 1 day filter comes first', /data-days="1"[^>]*>1 day<\/button>\s*<button type="button" data-days="7"/.test(mk.text));
    const r1 = await call('/api/marketing/report?days=1', { cookie: staff });
    check('3 the 1 day report answers', r1.status === 200, String(r1.status));
    const r7 = await call('/api/marketing/report?days=7', { cookie: staff });
    check('3 and the 7 day one still does', r7.status === 200);

    /* 9 names */
    const login = await call('/login');
    check('9 no personal name in the sign-in form', !/Sakhamuri/.test(login.text) && /placeholder="Enter your full name"/.test(login.text));

    /* 5 tags, 12 links, 13 http, 11 pictures, 6 previews */
    const mk_post = (title, tag, body) => call('/api/staff/posts', { method: 'POST', cookie: staff, body: { title, tag, body, status: 'published', excerpt: 'About ' + title } });
    const p1 = await mk_post('Germany APS guide 283', 'Study in Germany, APS', 'Read [the blog](http://www.glovels.com/blog) and [DAAD](https://www.daad.de).\n\nMore text here for the guide.');
    check('5 a post takes several tags', p1.status === 200 || p1.status === 201, p1.status + ' ' + JSON.stringify(p1.body).slice(0, 120));
    const slug1 = (p1.body.post && p1.body.post.slug) || 'germany-aps-guide-283';
    const page1 = await call('/post/' + slug1);
    check('5 the post shows its tags as links', /class="tagchip" href="\/blog\/tag\/study-in-germany"/.test(page1.text) && /href="\/blog\/tag\/aps"/.test(page1.text));
    check('13 a link to our own site over http is served as /', /href="\/blog"/.test(page1.text) && !/http:\/\/www\.glovels\.com/.test(page1.text));
    check('12 links in posts are underlined with focus styles', /id="glv-links"/.test(page1.text) && /text-decoration:underline/.test(page1.text) && /focus-visible/.test(page1.text));
    const tagPage = await call('/blog/tag/study-in-germany');
    check('5 the tag has its own page', tagPage.status === 200 && tagPage.text.includes('Germany APS guide 283'));
    check('5 a tag with fewer than 3 posts is not indexed', /noindex/.test(tagPage.text));
    await mk_post('Germany guide two 283', 'Study in Germany', 'Text.');
    await mk_post('Germany guide three 283', 'Study in Germany', 'Text.');
    await new Promise(r => setTimeout(r, 61000));   // the tag table is cached for a minute
    const tagPage3 = await call('/blog/tag/study-in-germany');
    const sm = (await call('/sitemap.xml')).text + (await call('/sitemap-pages.xml')).text;
    check('5 with 3 posts the tag page is in the sitemap; a thin one is not', tagPage3.status === 200 && /blog\/tag\/study-in-germany</.test(sm) && !/blog\/tag\/aps</.test(sm));
    const blog = await call('/blog');
    check('5 the blog lists the tags as filters', /aria-label="Topics"/.test(blog.text) && /href="\/blog\/tag\/study-in-germany"/.test(blog.text));
    check('5 a made-up tag is a 404', (await call('/blog/tag/no-such-tag-283')).status === 404);
    const plan = await call('/api/staff/posts/autotag', { method: 'POST', cookie: staff, body: {} });
    check('5 "Tag the posts" proposes tags without saving', plan.status === 200 && Array.isArray(plan.body.plan));
    const tl = await call('/api/staff/blog/tags', { cookie: staff });
    check('5 the office has an editable tag list', tl.status === 200 && (tl.body.tags || []).includes('Opportunity Card'));
    const ins = await call('/api/staff/posts/insecure', { cookie: staff });
    check('13 the http finder lists the post', ins.status === 200 && (ins.body.posts || []).some(x => x.slug === slug1));
    const wixBad = await call('/api/staff/wix/import', { method: 'POST', cookie: staff, body: { urls: ['https://example.com/post/x'] } });
    check('Wix: only Wix post addresses are accepted', wixBad.status === 422);

    /* In a browser: upload a picture, make its copies, see them on a post;
       and a .md file read into the editor. */
    browser = await chromium.launch();
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: staff.split('=')[0], value: staff.split('=').slice(1).join('='), url: BASE }]);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '/blog-admin', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const up = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1600;
      const g = c.getContext('2d');
      for (let i = 0; i < 400; i++) { g.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,50%)'; g.fillRect((i * 97) % 2400, (i * 53) % 1600, 180, 120); }
      const b = await new Promise(ok => c.toBlob(ok, 'image/png'));
      const fd = new FormData(); fd.append('file', b, 'big-test-picture.png');
      const r = await fetch('/api/staff/images', { method: 'POST', credentials: 'same-origin', body: fd });
      const d = await r.json();
      const out = await window.glvFastPicture(d.image.name);
      return { name: d.image.name, bytes: d.image.bytes, saved: (out.saved || []).map(x => x.name + ':' + x.bytes) };
    });
    check('11 a picture gets WebP copies 480/960/1600 and a preview copy', up.saved.length === 4 && up.saved.some(x => /--v480\.webp/.test(x)) && up.saved.some(x => /--og\.jpg/.test(x)), up.saved.join(' '));
    const og = up.saved.find(x => /--og\.jpg/.test(x));
    check('6 the preview copy is under 250 KB', og && Number(og.split(':')[1]) <= 250 * 1024, og);
    const v480 = up.saved.find(x => /--v480/.test(x));
    check('11 the phone copy is far smaller than the original', v480 && Number(v480.split(':')[1]) < up.bytes / 3, v480 + ' vs ' + up.bytes);
    const p2 = await call('/api/staff/posts', { method: 'POST', cookie: staff, body: { title: 'Picture post 283', tag: 'Study in UK', status: 'published', cover: '/images/' + up.name,
      body: '![a test picture](/images/' + up.name + ')\n\nWords.\n\n![second](/images/' + up.name + ')' } });
    const slug2 = (p2.body.post && p2.body.post.slug) || 'picture-post-283';
    const page2 = await call('/post/' + slug2);
    check('11 the post offers the copies through srcset', /<picture><source type="image\/webp" srcset="[^"]*--v480\.webp 480w, [^"]*--v960\.webp 960w/.test(page2.text));
    check('11 width and height are written', /width="2400" height="1600"/.test(page2.text));
    check('11 the first picture loads at once, the rest lazily', /loading="eager" fetchpriority="high"/.test(page2.text) && /loading="lazy"/.test(page2.text));
    check('6 the post\'s og:image is the 1200×630 copy', /property="og:image" content="[^"]*--og\.jpg"/.test(page2.text) && /og:image:width" content="1200"/.test(page2.text));
    check('6 og:title, og:description, og:url and the Twitter card are in the page', /property="og:title"/.test(page2.text) && /property="og:description"/.test(page2.text) && /property="og:url"/.test(page2.text) && /name="twitter:card"/.test(page2.text));
    const ogImg = await call('/images/' + up.name.replace(/\.png$/, '') + '--og.jpg');
    check('6 the preview picture is publicly fetchable', ogImg.status === 200 && /image\/jpeg/.test(ogImg.headers['content-type'] || ''));
    const md = await page.evaluate(() => window.glvParseMd('---\ntitle: TU Munich fees 2027\nslug: tum-fees-2027\ntags: Study in Germany, Universities\nexcerpt: What changes\n---\n\n## What changed\n\nText.', 'x.md'));
    check('.md: the front matter fills the post', md.title === 'TU Munich fees 2027' && md.slug === 'tum-fees-2027' && md.tag === 'Study in Germany, Universities' && /^## What changed/.test(md.body));
    const md2 = await page.evaluate(() => window.glvParseMd('# A heading title\n\nBody text.', 'my-file.md'));
    check('.md: without front matter the first heading is the title', md2.title === 'A heading title' && md2.body.trim() === 'Body text.');
    await page.click('#toolsBtn'); await page.waitForTimeout(800);
    check('Blog screen has the tools', await page.isVisible('#fastGo') && await page.isVisible('#tagList') && await page.isVisible('#mdBtn'));
    check('no script errors on the Blog screen', errs.length === 0, errs.join(' | ').slice(0, 200));
  } catch (e) {
    check('test ran', false, String(e && e.stack || e).slice(0, 300));
  } finally {
    if (browser) await browser.close();
    console.log('\nround283: ' + ok.length + ' passed, ' + bad.length + ' failed');
    bad.forEach(b => console.log('  ✗ ' + b));
    process.exit(bad.length ? 1 : 0);
  }
})();
