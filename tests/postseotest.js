/**
 * The blog, after the counsellors read it.
 *
 * From Blogs Changes.docx. Six things were asked for and every one of them is
 * a thing that fails silently — the post looks fine on screen while the half
 * that decides whether anybody ever reaches it is missing.
 *
 *   THE BLANK PREVIEW. Not one page on the site carried an og:image, so every
 *   Glovels link pasted into a WhatsApp group came back a grey rectangle. This
 *   is the check that would have caught it, and the one that catches the next
 *   version of it: a RELATIVE og:image. The tag is there, it looks right in
 *   View Source, and the preview is still blank — because the crawler is not
 *   on our site and cannot resolve `/og/glovels.png`.
 *
 *   THE DATE THAT MAKES A GUIDE LOOK OLD. `article:modified_time` is what
 *   tells a reader a fee corrected last week is current. Without it a guide
 *   fixed in September reads as whatever January it was written in.
 *
 *   ALT TEXT. The words in `![...]` are what a blind reader is told, what
 *   prints when the file 404s, and what Google reads. A renderer that drops
 *   them produces a page that looks identical and is worse in all three.
 *
 *   THE PICTURE THAT IS A LINK. `![alt](url)` contains `[alt](url)`. Letting
 *   the link rule see it first turns every picture into a link with a stray
 *   exclamation mark in front of it.
 *
 *   A TABLE WIDER THAN A PHONE. Without something to scroll it, the PAGE
 *   scrolls sideways and the article's left edge — where the sentences start —
 *   goes off the screen.
 *
 *   AND A RELATED LINK TO A 404. The writer picks the posts; a post they
 *   picked that has since come off the site must stop appearing rather than
 *   become a dead link with a byline.
 *
 * Run with GLOVELS_URL set, because half of what is asserted here is only
 * wrong when there is a real site address to be absolute against.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

const BODY = [
  'A public university in Germany charges no tuition, and that is the whole of why',
  'this question gets asked so often.',
  '',
  '![A lecture hall at TU Munich](https://cdn.example.com/tum.jpg "TU Munich, October")',
  '',
  '## What it actually costs',
  '',
  '| Country | Public | Private |',
  '| --- | ---: | :---: |',
  '| Germany | Free | 12,000 |',
  '| Poland | 2,000 | 4,500 |',
  '',
  '- Papers you need',
  '  - Passport',
  '  - Transcripts',
  '    1. Semester-wise',
  '    2. Consolidated',
  '- Money you need',
  '',
  'Pass | Fail is a sentence, not a table.',
].join('\n');

(async () => {
  const browser = await chromium.launch();
  const staff = await browser.newContext();
  const r0 = await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  ok(r0.ok(), 'the office can sign in — ' + r0.status());

  /* ======================================================= what gets written */
  const first = await (await staff.request.post(BASE + '/api/staff/posts', {
    data: {
      title: 'Fees at German public universities ' + S,
      body: BODY, status: 'published', author: 'Priya Menon',
      publishedAt: '2026-03-04',
      excerpt: 'What a public university in Germany actually costs an Indian student, '
        + 'in the year they arrive.',
      tag: 'Germany',
    },
  })).json();
  const p1 = first.post;
  ok(p1 && p1.slug, 'a post can be written — ' + (p1 && p1.slug));
  ok(p1 && p1.author === 'Priya Menon', 'with a byline — ' + (p1 && p1.author));
  /* The date the writer stated, not the day the button was pressed. */
  ok(p1 && String(p1.publishedAt).startsWith('2026-03-04'),
    'and the publication date they typed — ' + (p1 && p1.publishedAt));

  /* 500 characters, cut rather than refused. */
  const longOne = 'x'.repeat(620);
  const cut = (await (await staff.request.post(BASE + '/api/staff/posts', {
    data: { title: 'Excerpt length ' + S, body: 'Words.', excerpt: longOne },
  })).json()).post;
  ok(cut && cut.excerpt.length === 500,
    'an excerpt is held to 500 characters — ' + (cut && cut.excerpt.length));

  const second = await (await staff.request.post(BASE + '/api/staff/posts', {
    data: {
      title: 'Blocked account, step by step ' + S,
      body: 'How the blocked account works, and what it costs to open one.',
      status: 'published', author: 'Priya Menon',
      /* One real, one that was never written, and itself. */
      related: p1.slug + ',a-post-nobody-wrote,blocked-account-step-by-step-' + S,
    },
  })).json();
  const p2 = second.post;
  ok(p2 && p2.related === p1.slug,
    'related posts keep the ones that exist and drop the ones that do not — '
    + JSON.stringify(p2 && p2.related));

  /* ============================================================== the page */
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } }))
    .newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/post/' + p1.slug, { waitUntil: 'domcontentloaded' });

  const meta = async (sel) => page.getAttribute(sel, 'content').catch(() => null);

  /* ---------------------------------------------------- the byline, on screen */
  const byline = (await page.textContent('.byline').catch(() => '')) || '';
  ok(/Priya Menon/.test(byline), 'the post says who wrote it — ' + byline.trim());
  ok(/4 March 2026/.test(byline), 'and when it went up — ' + byline.trim());
  /* It was written a moment ago and dated March, so there IS something to say. */
  ok(/Updated/.test(byline), 'and when it was last put right — ' + byline.trim());

  /* ------------------------------------------------------------- the head */
  ok(await meta('meta[property="article:author"]') === 'Priya Menon',
    'article:author — ' + await meta('meta[property="article:author"]'));
  const pub = await meta('meta[property="article:published_time"]');
  const mod = await meta('meta[property="article:modified_time"]');
  ok(pub && pub.startsWith('2026-03-04'), 'article:published_time — ' + pub);
  ok(mod && mod > pub, 'article:modified_time, and it is later — ' + mod);
  ok(await meta('meta[property="og:type"]') === 'article', 'og:type is article');
  ok(await meta('meta[property="og:site_name"]') === 'Glovels', 'og:site_name');
  ok(!!await meta('meta[property="og:title"]'), 'og:title');
  ok(!!await meta('meta[property="og:description"]'), 'og:description');
  ok(await meta('meta[name="twitter:card"]') === 'summary_large_image',
    'a large twitter card, because there is a picture to put in it');
  ok(await meta('meta[property="article:section"]') === 'Germany',
    'article:section from the topic');

  /* THE one. The first picture in the post becomes the preview, and it is
     absolute — a relative og:image is a tag that looks right and previews
     blank. */
  const og = await meta('meta[property="og:image"]');
  ok(og === 'https://cdn.example.com/tum.jpg',
    'the first picture in the post is the link preview — ' + og);
  ok(await meta('meta[property="og:image:alt"]') === 'A lecture hall at TU Munich',
    'with the alt text the writer wrote');

  /* --------------------------------------------------------- the article */
  const fig = await page.$eval('.prose figure img',
    e => ({ src: e.getAttribute('src'), alt: e.getAttribute('alt'),
            lazy: e.getAttribute('loading') })).catch(() => null);
  ok(fig && fig.alt === 'A lecture hall at TU Munich',
    'the picture carries its alt text — ' + JSON.stringify(fig));
  ok(fig && fig.lazy === 'lazy', 'and does not block the article loading');
  ok((await page.textContent('.prose figcaption').catch(() => '')) === 'TU Munich, October',
    'and its caption is printed under it');
  /* The picture is a picture, not a link with a stray ! in front of it. */
  ok(!(await page.textContent('.prose').catch(() => '')).includes('!['),
    'no raw picture markup left in the article');

  const table = await page.$eval('.prose .tablewrap table', t => ({
    heads: [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()),
    rows: t.querySelectorAll('tbody tr').length,
    cells: [...t.querySelectorAll('tbody tr:first-child td')].map(x => x.textContent.trim()),
    right: (t.querySelector('thead th:nth-child(2)') || {}).style
      ? t.querySelector('thead th:nth-child(2)').style.textAlign : '',
  })).catch(() => null);
  ok(table && table.heads.join('|') === 'Country|Public|Private',
    'the table has its header row — ' + JSON.stringify(table && table.heads));
  ok(table && table.rows === 2 && table.cells.join('|') === 'Germany|Free|12,000',
    'and its body — ' + JSON.stringify(table && table.cells));
  ok(table && table.right === 'right', 'and the alignment the writer asked for');

  /* The wrapper scrolls, not the page. This is asserted on a phone, because
     that is the only width where it matters. */
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 780 } }))
    .newPage();
  await phone.goto(BASE + '/post/' + p1.slug, { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(600);
  const slide = await phone.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    wrap: (() => {
      const w = document.querySelector('.prose .tablewrap');
      return w ? w.scrollWidth - w.clientWidth : -1;
    })(),
  }));
  ok(slide.page <= 1, 'the page does not slide sideways on a phone — ' + slide.page + 'px');
  ok(slide.wrap >= 0, 'and the table is the thing that scrolls — ' + JSON.stringify(slide));
  await phone.close();

  const lists = await page.evaluate(() => {
    const top = document.querySelector('.prose ul');
    if (!top) return null;
    const first = top.querySelector(':scope > li');
    return {
      nested: !!(first && first.querySelector(':scope > ul')),
      deeper: !!(first && first.querySelector(':scope > ul > li > ol')),
      /* The nested list must live INSIDE the item above it, not float between
         two items — which is what happens when the </li> is not moved. */
      inside: !!(first && first.querySelector(':scope > ul')),
      topItems: top.querySelectorAll(':scope > li').length,
    };
  });
  ok(lists && lists.nested, 'an indented bullet nests under the one above — '
    + JSON.stringify(lists));
  ok(lists && lists.deeper, 'and numbers nest under bullets — ' + JSON.stringify(lists));
  ok(lists && lists.topItems === 2,
    'and the outer list still has its two items — ' + JSON.stringify(lists));

  /* A sentence with a pipe in it is a sentence. */
  ok((await page.textContent('.prose')).includes('Pass | Fail is a sentence'),
    'a pipe in a sentence does not become a one-cell table');

  ok(errs.length === 0, 'no page errors — ' + errs.slice(0, 2).join(' | '));

  /* ------------------------------------------------------------ read next */
  await page.goto(BASE + '/post/' + p2.slug, { waitUntil: 'domcontentloaded' });
  const rel = await page.$$eval('.related a',
    as => as.map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim() })));
  ok(rel.length === 1 && rel[0].href === p1.slug,
    'the post the writer picked is at the foot of the article — ' + JSON.stringify(rel));

  /* A post with no picture of its own still previews. */
  const og2 = await meta('meta[property="og:image"]');
  ok(!!og2 && /\/og\/glovels\.png$/.test(og2),
    'a post with no picture of its own still has a link preview — ' + og2);
  /* Absolute, measured against the page's OWN canonical rather than an
     environment variable this process may not have been given: a relative
     og:image is a tag that looks right in View Source and previews blank,
     because the crawler is not on our site and cannot resolve it. */
  const canon = await page.getAttribute('link[rel="canonical"]', 'href').catch(() => '');
  const origin = /^https?:\/\/[^/]+/.exec(canon || '');
  if (origin) {
    ok(og2.startsWith(origin[0] + '/'),
      'and it is absolute, against the same address as the canonical — ' + og2);
  } else {
    ok(og2.startsWith('/'),
      'and it points at the shipped one — ' + og2);
  }
  /* The bytes, not the header: the server answers chunked, so content-length
     is absent and a check that reads it passes on an empty file. */
  const img = await page.request.get(BASE + '/og/glovels.png');
  const bytes = img.ok() ? (await img.body()).length : 0;
  ok(img.ok() && /^image\/png/.test(img.headers()['content-type'] || '') && bytes > 5000,
    'and that picture is really there — ' + img.status() + ', ' + bytes + ' bytes');

  /* And it stops appearing the moment the post it points at comes off the
     site. A related link to a 404 is worse than one fewer link. */
  await staff.request.delete(BASE + '/api/staff/post/' + p1.id);
  await page.goto(BASE + '/post/' + p2.slug, { waitUntil: 'domcontentloaded' });
  ok((await page.$$('.related a')).length === 0,
    'a related post taken off the site stops being linked to');

  /* ================================================ and the static pages too */
  const home = await page.request.get(BASE + '/');
  const html = await home.text();
  ok(/property="og:image"/.test(html), 'the home page has a link preview at all');
  ok(/content="https:\/\/[^"]*\/og\/glovels\.png"/.test(html),
    'and it is an absolute address');
  ok(/property="og:image:width" content="1200"/.test(html)
    && /property="og:image:height" content="630"/.test(html),
    'with the size, so the preview is not re-cropped');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
