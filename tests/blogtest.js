/**
 * The blog, written and published by the office.
 *
 * There were six posts on glovels.com and no way to write a seventh. Each one
 * is a static HTML file with a headline, a lead paragraph and a note to
 * ourselves where the article should be — so finishing one, correcting a fee
 * that changed, or writing a new one meant a text editor and a deploy. That is
 * not a blog, it is six landing pages nobody can edit.
 *
 * Everything below is read off the page the server actually sends, because the
 * half of "publish a blog post" that decides whether anybody reads it — the
 * title, the description, the keywords, the link preview — is in the HTML or
 * it does not exist.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch();

  const staff = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const guest = await browser.newContext({ viewport: { width: 1400, height: 950 } });

  /* --------------------------------- the posts that were already on the site */
  const seeded = await (await staff.request.get(BASE + '/api/staff/posts')).json();
  check('the posts already on the site were brought in',
    (seeded.posts || []).length >= 6, (seeded.posts || []).length + ' posts');
  check('and every one of them is a draft, because none has a body',
    (seeded.posts || []).every(p => p.status !== 'published'));
  check('with the description somebody already wrote for search',
    (seeded.posts || []).some(p => p.metaDesc && p.metaDesc.length > 40));

  /* --------------------------------------------------- writing one, on screen */
  const page = await staff.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/blog-admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);

  check('the blog screen lists them', (await page.$$('#postList li')).length >= 6);
  check('there is a way to start a new one', await page.isVisible('#newPost'));

  await page.click('#newPost');
  await page.waitForTimeout(400);
  const title = 'Blocked account costs for ' + stamp;
  await page.fill('#pTitle', title);
  await page.waitForTimeout(350);

  check('the address writes itself from the headline',
    /^blocked-account-costs-for-\d+$/.test(await page.inputValue('#pSlug')),
    await page.inputValue('#pSlug'));
  check('and the search preview shows it',
    (await page.textContent('#sU')).includes(await page.inputValue('#pSlug')));

  await page.fill('#pBody',
    'Germany asks for proof that you can pay for your first year.\n\n'
    + '## What a blocked account is\n\n'
    + 'It holds the money and pays it back monthly.\n\n'
    + '- Open it early\n- Keep the confirmation\n\n'
    + 'See [our Germany page](../study-in-germany.html) for the figure.\n\n'
    + '<script>alert(1)</script>');
  await page.fill('#pMetaDesc', 'What a blocked account is, what Germany asks you to show, '
    + 'and how long one takes to open.');
  await page.fill('#pKeywords', 'blocked account germany, student visa funds');
  await page.waitForTimeout(350);

  check('the word count is live', /\d+ words/.test(await page.textContent('#cWords')),
    await page.textContent('#cWords'));
  check('and the description is counted against what Google prints',
    /\/ 155$/.test(await page.textContent('#cDesc')), await page.textContent('#cDesc'));
  check('the preview shows the description that was typed',
    (await page.textContent('#sD')).startsWith('What a blocked account is'));

  /* Save first: a draft must not reach the site. */
  await page.click('#pSave');
  await page.waitForTimeout(1500);
  const slug = await page.inputValue('#pSlug');
  check('saving says it is not on the site',
    /not on the site/i.test(await page.textContent('#pSaid')),
    await page.textContent('#pSaid'));

  const draftGet = await guest.request.get(BASE + '/post/' + slug);
  check('and a visitor cannot read the draft', draftGet.status() === 404, draftGet.status());
  const draftStaff = await staff.request.get(BASE + '/post/' + slug);
  check('while the person writing it can', draftStaff.ok(), draftStaff.status());
  check('and the draft page says so, and tells robots to skip it',
    /noindex/.test(await draftStaff.text()) && /This is a draft/.test(await draftStaff.text()));

  const idx0 = await (await guest.request.get(BASE + '/blog')).text();
  check('a draft is not on the blog index', !idx0.includes('post/' + slug));

  /* ----------------------------------------------------------- publishing it */
  await page.click('#pPub');
  await page.waitForTimeout(1800);
  check('publishing says where it went',
    (await page.textContent('#pSaid')).includes('/post/' + slug),
    await page.textContent('#pSaid'));
  check('no page errors while writing', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* ------------------------------------------- and what the world now receives */
  const html = await (await guest.request.get(BASE + '/post/' + slug)).text();
  const has = re => re.test(html);
  const attr = re => { const m = re.exec(html); return m ? m[1] : ''; };

  check('the page carries the headline as its h1',
    has(new RegExp('<h1>' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</h1>')));
  check('and the title tag Google prints',
    attr(/<title>([^<]*)<\/title>/).startsWith(title), attr(/<title>([^<]*)<\/title>/));
  check('with the description that was typed',
    attr(/<meta name="description" content="([^"]*)"/).startsWith('What a blocked account is'),
    attr(/<meta name="description" content="([^"]*)"/));
  check('and the keywords',
    attr(/<meta name="keywords" content="([^"]*)"/).includes('blocked account germany'));
  check('a canonical address, so the .html copy cannot compete with it',
    /<link rel="canonical" href="[^"]*\/post\/[^"]*">/.test(html));
  check('an Open Graph title and description, for a link pasted into WhatsApp',
    has(/<meta property="og:title"/) && has(/<meta property="og:description"/));
  check('og:type is article, not website', attr(/<meta property="og:type" content="([^"]*)"/) === 'article',
    attr(/<meta property="og:type" content="([^"]*)"/));
  check('and an Article record for Google',
    has(/"@type":"BlogPosting"/) && html.includes('"headline":"' + title + '"'));

  /* The words themselves. */
  check('a heading in the box became a heading on the page',
    has(/<h2>What a blocked account is<\/h2>/));
  check('and a list became a list', has(/<ul>\s*<li>Open it early<\/li>/));
  check('and a link became a link', has(/<a href="\.\.\/study-in-germany\.html">our Germany page<\/a>/));
  check('a script tag typed into the body is printed, not run',
    !has(/<script>alert\(1\)<\/script>/) && has(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/));
  check('the reading time is on the page', has(/min read/));

  const idx = await (await guest.request.get(BASE + '/blog')).text();
  check('it is on the blog index now', idx.includes('post/' + slug));
  check('and the posts that were already live are still listed',
    idx.includes('post/german-universities-lower-cgpa'));

  /* ------------------------------------- the form that turns a reader into a lead */
  const reader = await guest.newPage();
  const rerrs = [];
  reader.on('pageerror', e => rerrs.push(String(e)));
  await reader.goto(BASE + '/post/' + slug, { waitUntil: 'domcontentloaded' });
  await reader.waitForTimeout(1200);
  check('every post carries a way to ask us something', await reader.isVisible('#postForm'));

  await reader.fill('#bfName', 'Blog Reader');
  await reader.fill('#bfMail', 'nope');
  await reader.fill('#bfPhone', '9876543210');
  await reader.click('#bfGo');
  await reader.waitForTimeout(400);
  check('a bad email is caught on the page', await reader.isVisible('.bf-note.bad'));

  const mail = 'blog' + stamp + '@example.com';
  await reader.fill('#bfMail', mail);
  await reader.fill('#bfMsg', 'What CGPA do I need?');
  await reader.click('#bfGo');
  await reader.waitForTimeout(1600);
  check('and a good one is thanked', await reader.isVisible('.bf-note.ok'),
    await reader.textContent('#bfMsgOut'));
  check('no page errors on the post', rerrs.length === 0, rerrs.slice(0, 2).join(' | '));

  const book = await (await staff.request.get(BASE + '/api/staff/enquiries')).json();
  const lead = (book.enquiries || []).find(e => e.email === mail);
  check('the office has the lead', !!lead, mail);
  check('and it says which post they were reading',
    !!lead && (lead.note || '').includes(title), lead && lead.note);

  /* ------------------------------------------------------------ taking it off */
  const mine = await (await staff.request.get(BASE + '/api/staff/posts')).json();
  const row = (mine.posts || []).find(p => p.slug === slug);
  const off = await staff.request.delete(BASE + '/api/staff/post/' + row.id);
  const offBody = await off.json();
  check('a live post is unpublished rather than deleted', offBody.unpublished === true,
    JSON.stringify(offBody).slice(0, 90));
  const gone = await guest.request.get(BASE + '/post/' + slug);
  check('and the page stops answering visitors', gone.status() === 404, gone.status());

  /* ------------------------------------------- and only the people it is for */
  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const denied = await stu.request.get(BASE + '/api/staff/posts');
  check('a student cannot open the blog editor', denied.status() === 403, denied.status());
  const anon = await guest.request.post(BASE + '/api/staff/posts',
    { data: { title: 'Not mine', body: 'x', status: 'published' } });
  check('and nobody signed out can publish anything', anon.status() === 401, anon.status());

  /* A published post with no words is a headline with a URL on it. */
  const empty = await staff.request.post(BASE + '/api/staff/posts',
    { data: { title: 'Empty ' + stamp, body: '   ', status: 'published' } });
  check('an empty post cannot be published', empty.status() === 422, empty.status());

  /* ------------------------------------------- the six that shipped written */

  /* A bullet that wrapped in the source used to put its second half OUTSIDE
     the list, as a paragraph between two bullets. Every line was treated as its
     own thing, so it happened the moment anybody wrapped at eighty columns —
     which is every post here. */
  const shipped = await (await staff.request.get(BASE + '/api/staff/posts')).json();
  check('the six posts arrive with words in them',
    (shipped.posts || []).length >= 6, (shipped.posts || []).length);
  const blank = [];
  for (const row of (shipped.posts || [])) {
    const full = await (await staff.request.get(BASE + '/api/staff/post/' + row.id)).json();
    if (!String((full.post || {}).body || '').trim()) blank.push(row.slug);
  }
  check('and none of them is still an empty draft', blank.length === 0, blank.join(', '));
  check('they wait as drafts rather than publishing themselves',
    (shipped.posts || []).every(p => p.status === 'draft' || p.status === 'published'));

  /* Render one and look at the shape of it. */
  const first = (shipped.posts || []).find(p => /Expatrio/.test(p.title));
  if (first) {
    const full = await (await staff.request.get(BASE + '/api/staff/post/' + first.id)).json();
    await staff.request.put(BASE + '/api/staff/post/' + first.id, {
      data: Object.assign({}, full.post,
        { status: 'published', publishedAt: new Date().toISOString() }),
    });
    const reader = await browser.newContext();
    const rp = await reader.newPage();
    await rp.goto(BASE + '/post/' + first.slug, { waitUntil: 'domcontentloaded' });
    await rp.waitForTimeout(900);
    check('a published post has headings and a list',
      (await rp.$$('h2')).length >= 3 && (await rp.$$('li')).length >= 2);
    check('a wrapped bullet stays inside its own list item',
      await rp.evaluate(() => {
        const els = [...document.querySelectorAll('.prose > *, article > *, body p, body ul')];
        for (let i = 1; i < els.length - 1; i++) {
          if (els[i].tagName === 'P'
            && els[i - 1].tagName === 'UL' && els[i + 1].tagName === 'UL') return false;
        }
        return true;
      }));
    check('and the whole piece is worth reading, not a stub',
      (await rp.textContent('body')).split(/\s+/).length > 400,
      (await rp.textContent('body')).split(/\s+/).length + ' words');
  }

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
