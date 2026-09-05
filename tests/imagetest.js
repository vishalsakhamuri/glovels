/**
 * Pictures in blog posts, and the blog on glovels.com brought across.
 *
 * Two faults from the testing round, one screen:
 *
 *   "From the admin panel I cannot add images to blogs and publish like we
 *    have current blogs."
 *
 *   "All the pages are not copied to glovels.onrender.com."
 *
 * The first was true in the plainest way: the editor could PRINT a picture
 * from the day it existed — `![alt](url)` — and nobody could use it, because
 * the address had to be one that already existed somewhere on the internet.
 * There was no way to get a file from a laptop onto the server.
 *
 * The second is a hundred and twenty posts on a Wix site. This suite stands
 * in a small Wix of its own on a port — a sitemap and two post pages in the
 * markup Wix actually serves — and checks that what comes out the other end is
 * a draft with the same address, the same words, and the pictures on OUR disk.
 *
 * Run with the server started as:  WIX_BASE=http://localhost:8123
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'http://localhost:8099';
const WIX_PORT = 8123;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

/* A real PNG, 1×1, so the signature check has something to agree with. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');
/* A JPEG's first bytes, with nothing behind them — enough to be recognised. */
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

/* --------------------------------------------------- a Wix, in miniature */
const CDN = 'https://static.wixstatic.com/media/';
const HERO = '564c6b_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa~mv2.png';
const BODYPIC = '564c6b_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb~mv2.jpg';
const wixPost = (slug, title, extra) => `<!doctype html><html><head>
<title>${title} | Glovels</title>
<meta name="description" content="Description of ${title} &amp; more">
<meta property="og:title" content="${title}">
<meta property="og:image" content="${CDN}${HERO}/v1/fill/w_1000,h_563/${HERO}">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","author":{"@type":"Person","name":"maurya2pi"},"datePublished":"2025-03-04T10:00:00.000Z","headline":"${title}","description":"Description of ${title}"}</script>
</head><body><div id="SITE_CONTAINER"><article data-hook="post">
<section data-hook="post-hero-image"></section><h1 data-hook="post-title">${title}</h1>
<section data-hook="post-description" class="VQDdIN"><div class="moHCnT"><div>
<p class="vVP7K"><span><span>Opening line about ${title}.</span></span></p></div>
<div data-hook="rcv-block1"></div>
<h2>A heading</h2>
<div><p>A paragraph with <strong>bold</strong> and a <a href="https://www.lmu.de/en/?x=1" target="_blank"><u><span>link out</span></u></a> and <a href="https://www.glovels.com/post/other-post">a link home</a>.</p></div>
<ul><li dir="auto"><p><span>First bullet</span></p></li><li><p>Second bullet</p><ul><li><p>Nested</p></li></ul></li></ul>
<figure data-hook="figure-IMAGE"><div><wow-image data-image-info='{"containerId":"c","imageData":{"width":1672,"height":941,"uri":"${BODYPIC}","name":"","displayMode":"fill"}}'><img src="${CDN}${BODYPIC}/v1/fill/w_49,h_28/x.jpg" alt=""></wow-image><button data-hook="image-expand-button"><svg><path d="M"/></svg></button></div></figure>
<table><tr><th>Charge</th><th>Expatrio</th></tr><tr><td>Setup</td><td>€119</td></tr></table>
${extra || ''}
</div></section><div data-hook="post-footer">footer</div></article></div></body></html>`;

function wixServer() {
  const posts = {
    'first-post-from-wix': wixPost('first-post-from-wix', 'First Post From Wix'),
    'second-post-from-wix': wixPost('second-post-from-wix', 'Second Post &amp; Friends'),
    /* A page with no article on it — what Wix serves for a deleted post. */
    'gone-post': '<html><body><h1>Not here</h1></body></html>',
  };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/blog-posts-sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end('<?xml version="1.0"?><urlset>'
        + Object.keys(posts).map(s => '<url><loc>https://www.glovels.com/post/' + s + '</loc></url>').join('')
        + '<url><loc>https://www.glovels.com/blog</loc></url></urlset>');
    }
    const pic = /^\/media\/([a-z0-9_]+~mv2\.(png|jpg))$/.exec(u.pathname);
    if (pic) {
      res.writeHead(200, { 'content-type': 'image/' + (pic[2] === 'png' ? 'png' : 'jpeg') });
      return res.end(pic[2] === 'png' ? PNG : JPG);
    }
    const m = /^\/post\/([a-z0-9-]+)$/.exec(u.pathname);
    if (m && posts[m[1]]) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(posts[m[1]]);
    }
    res.writeHead(404); res.end('no');
  });
  return new Promise(r => srv.listen(WIX_PORT, () => r(srv)));
}

(async () => {
  const wix = await wixServer();
  const browser = await chromium.launch();
  const staff = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const guest = await browser.newContext();
  const stamp = Date.now();

  /* --------------------------------------------------- the upload route */
  let r = await staff.request.post(BASE + '/api/staff/images', {
    multipart: { file: { name: 'Photo of TUM (1).PNG', mimeType: 'image/png', buffer: PNG } },
  });
  let d = await r.json();
  check('a PNG goes up', r.status() === 200 && d.image && d.image.url, JSON.stringify(d).slice(0, 120));
  const url1 = d.image && d.image.url;
  check('and gets a safe name minted from the original', /^\/images\/photo-of-tum-1-[a-z0-9]+\.png$/.test(url1 || ''), url1);

  r = await guest.request.get(BASE + url1);
  check('the picture is public', r.status() === 200 && r.headers()['content-type'] === 'image/png');
  check('and cached for a year — its name changes when the file does',
    /max-age=31536000/.test(r.headers()['cache-control'] || ''));
  const back = await r.body();
  check('and comes back byte for byte', back.equals(PNG));

  r = await staff.request.post(BASE + '/api/staff/images', {
    multipart: { file: { name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload=alert(1)>') } },
  });
  check('a file named .png that is not one inside is refused', r.status() === 415);

  r = await staff.request.post(BASE + '/api/staff/images', {
    multipart: { file: { name: 'x.jpg', mimeType: 'image/jpeg', buffer: JPG } },
  });
  d = await r.json();
  check('a JPG goes up', r.status() === 200 && /\.jpg$/.test((d.image || {}).url || ''));
  const url2 = d.image.url;

  r = await staff.request.post(BASE + '/api/staff/images', {
    multipart: { file: { name: 'big.png', mimeType: 'image/png',
      buffer: Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]) } },
  });
  check('nine megabytes is refused with the limit in the sentence', r.status() === 415
    && /8 MB/.test((await r.json()).error || ''));

  r = await guest.request.post(BASE + '/api/staff/images', {
    multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: PNG } },
  });
  check('a visitor cannot upload', r.status() === 401 || r.status() === 403);

  r = await guest.request.get(BASE + '/images/../glovels.db');
  check('/images/../ reaches nothing', r.status() === 404 || r.status() === 403);
  r = await guest.request.get(BASE + '/images/nothing-here.png');
  check('and a name that was never minted is a 404', r.status() === 404);

  r = await staff.request.get(BASE + '/api/staff/images');
  d = await r.json();
  check('the list has both, newest first', d.images.length >= 2 && d.images[0].url === url2, JSON.stringify(d.images.map(i => i.url)));

  /* ----------------------------------------------------- on the screen */
  const page = await staff.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + '/blog-admin');
  await page.click('#newPost');
  await page.click('#pTitle');
  await page.fill('#pTitle', 'A post with pictures ' + stamp);
  await page.click('#pBody');
  await page.fill('#pBody', 'First paragraph.\n\nSecond paragraph.');
  /* Cursor at the end of the first paragraph. */
  await page.evaluate(() => { const t = document.querySelector('#pBody'); t.setSelectionRange(16, 16); });

  const tmp = path.join(os.tmpdir(), 'glovels-pic-' + stamp + '.png');
  fs.writeFileSync(tmp, PNG);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#picAdd'),
  ]);
  await chooser.setFiles(tmp);
  await page.waitForFunction(() => /!\[.*\]\(\/images\/[^)]+\.png\)/.test(document.querySelector('#pBody').value), null, { timeout: 8000 })
    .catch(() => {});
  const bodyNow = await page.inputValue('#pBody');
  check('Add a picture uploads the file and puts the line into the text', /!\[[^\]]+\]\(\/images\/glovels-pic-\d+-[a-z0-9]+\.png\)/.test(bodyNow), bodyNow.replace(/\n/g, '⏎'));
  check('on a line of its own, between the paragraphs',
    /First paragraph\.\n\n!\[[^\]]*\]\([^)]+\)\n\nSecond paragraph\./.test(bodyNow));
  check('with alt words the writer is told to replace, not an empty bracket', /!\[What the picture shows\]/.test(bodyNow));

  /* The cover. */
  const [chooser2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#coverUp'),
  ]);
  await chooser2.setFiles(tmp);
  await page.waitForFunction(() => /^\/images\//.test(document.querySelector('#pCover').value), null, { timeout: 8000 }).catch(() => {});
  const cover = await page.inputValue('#pCover');
  check('Upload a picture on the cover row fills the cover address', /^\/images\/.+\.png$/.test(cover), cover);
  check('and shows it', await page.locator('#coverPrev img').count() === 1);

  /* Pictures already up. */
  await page.click('#picPick');
  await page.waitForSelector('#picGrid .picgrid button', { timeout: 5000 }).catch(() => {});
  const gridN = await page.locator('#picGrid .picgrid button').count();
  check('"Pictures already up" lists what was uploaded', gridN >= 3, gridN + ' shown');
  await page.evaluate(() => { const t = document.querySelector('#pBody'); t.setSelectionRange(t.value.length, t.value.length); });
  await page.locator('#picGrid .picgrid button').first().click();
  const bodyAfter = await page.inputValue('#pBody');
  check('and picking one inserts it without a second upload', (bodyAfter.match(/!\[/g) || []).length === 2);
  check('the grid closes on a pick', await page.locator('#picGrid').isHidden());

  await page.click('#pPub');
  await page.waitForSelector('#pSaid:has-text("On the site")', { timeout: 8000 }).catch(() => {});
  const slug = await page.inputValue('#pSlug');

  /* ------------------------------------------------- what a reader gets */
  const pub = await guest.newPage();
  await pub.goto(BASE + '/post/' + slug);
  const html = await pub.content();
  check('the published post prints the picture from our own disk',
    (html.match(/<img src="\/images\/[^"]+\.png"/g) || []).length >= 2);
  check('as a figure, on its own', /<figure><img src="\/images\//.test(html));
  check('the cover is under the headline', /<figure class="cover"><img src="\/images\/[^"]+" alt="A post with pictures/.test(html));
  /* Absolute once GLOVELS_URL names the site — postseotest covers that; here
     there is no site address, so the path is what there is. */
  check('and og:image is the cover',
    new RegExp('<meta property="og:image" content="(?:http://localhost:8099)?' + cover.replace(/[.]/g, '\\.') + '"').test(html));
  const imgOk = await pub.evaluate(() => [...document.querySelectorAll('.prose img')].every(i => i.complete && i.naturalWidth > 0));
  check('every picture on the page actually loaded', imgOk);

  await pub.goto(BASE + '/blog');
  const card = await pub.locator('.postcard:has-text("A post with pictures")').first();
  check('the blog index card carries the cover as a thumbnail',
    await card.locator('img.thumb').count() === 1);

  /* A picture that is in a post cannot be deleted from under it. */
  const name = cover.replace('/images/', '');
  r = await staff.request.delete(BASE + '/api/staff/images/' + name);
  check('deleting a picture a post uses is refused and says which post', r.status() === 409
    && /A post with pictures/.test((await r.json()).error || ''));
  r = await staff.request.delete(BASE + '/api/staff/images/' + url2.replace('/images/', ''));
  check('deleting an unused one works', r.status() === 200);
  r = await guest.request.get(BASE + url2);
  check('and it is gone', r.status() === 404);

  /* ------------------------------------------- the glovels.com import */
  r = await staff.request.get(BASE + '/api/staff/wix/status');
  d = await r.json();
  check('the status route reads WIX_BASE', d.base === 'http://localhost:' + WIX_PORT, d.base);

  await page.click('#wixBtn');
  check('the panel opens from the Posts header', await page.locator('#wixBox').isVisible());
  await page.click('#wixGo');
  await page.waitForFunction(() => /Done\./.test(document.querySelector('#wixSaid').textContent), null, { timeout: 20000 }).catch(() => {});
  const said = await page.textContent('#wixSaid');
  check('it runs to the end and reports', /Done\. 3 of 3 read · 2 brought across/.test(said), said);
  check('one failed — the page with no article — and it is named',
    /1 failed/.test(said) && /gone-post — failed/.test(await page.textContent('#wixItems')));
  check('pictures were copied', /2 pictures copied/.test(said), said);

  r = await staff.request.get(BASE + '/api/staff/posts');
  const posts = (await r.json()).posts;
  const p1 = posts.find(p => p.slug === 'first-post-from-wix');
  const p2 = posts.find(p => p.slug === 'second-post-from-wix');
  check('both arrived at the same address they had on glovels.com', !!p1 && !!p2);
  check('as drafts — nothing is published by a machine', p1 && p1.status === 'draft' && p2.status === 'draft');
  check('with the headline decoded', p2 && p2.title === 'Second Post & Friends', p2 && p2.title);
  check('the meta description, decoded', p1 && p1.metaDesc === 'Description of First Post From Wix & more', p1 && p1.metaDesc);
  check('the author', p1 && p1.author === 'maurya2pi');
  check('and the original date, so a 2025 post does not read as new', p1 && /^2025-03-04/.test(p1.publishedAt), p1 && p1.publishedAt);
  check('the cover is on our disk, not Wix\'s', p1 && /^\/images\/wix-[a-z0-9_-]+\.png$/.test(p1.cover), p1 && p1.cover);

  r = await staff.request.get(BASE + '/api/staff/post/' + p1.id);
  const full = (await r.json()).post;
  const b = full.body;
  check('the opening line is the first paragraph', /^Opening line about First Post From Wix\./.test(b), b.slice(0, 80));
  check('headings are headings', /\n## A heading\n/.test(b));
  check('bold survives', /\*\*bold\*\*/.test(b));
  check('an outside link keeps its address', /\[link out\]\(https:\/\/www\.lmu\.de\/en\/\?x=1\)/.test(b));
  check('a link to glovels.com becomes a link on this site', /\[a link home\]\(\/post\/other-post\)/.test(b));
  check('bullets, nested', /\n- First bullet\n- Second bullet\n  - Nested\n/.test(b));
  check('the picture in the body is on our disk', /!\[\]\(\/images\/wix-[a-z0-9_-]+\.jpg\)/.test(b), (b.match(/!\[[^\]]*\]\([^)]+\)/g) || []).join(' '));
  check('the table is a table', /\| Charge \| Expatrio \|\n\| --- \| --- \|\n\| Setup \| €119 \|/.test(b));
  check('and the renderer draws it all',
    /<h2>A heading<\/h2>/.test(full.html) && /<table>/.test(full.html) && /<figure><img src="\/images\/wix-/.test(full.html));

  /* Running it again does not touch what is here. */
  await page.click('#wixGo');
  await page.waitForFunction(() => /2 already here/.test(document.querySelector('#wixSaid').textContent), null, { timeout: 20000 }).catch(() => {});
  const said2 = await page.textContent('#wixSaid');
  check('a second run leaves the two drafts alone', /2 already here/.test(said2), said2);

  /* Unless asked to replace drafts — and a published one is never replaced. */
  await staff.request.put(BASE + '/api/staff/post/' + p2.id, {
    data: Object.assign({}, full, { title: 'Second, published here', slug: 'second-post-from-wix', status: 'published', body: 'Our own words.' }),
  });
  await page.check('#wixOver');
  await page.click('#wixGo');
  await page.waitForFunction(() => /1 replaced/.test(document.querySelector('#wixSaid').textContent), null, { timeout: 20000 }).catch(() => {});
  const said3 = await page.textContent('#wixSaid');
  check('with Replace ticked the draft is replaced', /1 replaced/.test(said3), said3);
  r = await staff.request.get(BASE + '/api/staff/post/' + p2.id);
  check('and the one that is live on this site is not', (await r.json()).post.title === 'Second, published here');

  check('no script errors on the editor', !errors.length, errors.join(' | '));

  await browser.close();
  wix.close();
  try { fs.unlinkSync(tmp); } catch (e) {}

  console.log('\n' + ok.map(x => '  ✓ ' + x).join('\n'));
  if (bad.length) console.log('\n' + bad.map(x => '  ✗ ' + x).join('\n'));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
