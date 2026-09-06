/**
 * The site at the size it is heading: two hundred thousand universities and
 * ten thousand posts.
 *
 * Nothing here is big — the seeded database is a few hundred rows. What is
 * checked is the SHAPE: every list the site or the office draws is a page the
 * database hands over, with a total beside it, and the whole table is never
 * sent. A list that is a page at 200 rows is a page at 200,000; a list that is
 * the table at 200 rows is a download nobody finishes at 200,000.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const get = async (p, c) => (await (c || ctx).request.get(BASE + p)).json();

  /* ------------------------------------------- the office's programme list */
  const p1 = await get('/api/staff/catalogue?per=10');
  check('the catalogue answers a page, not the table', Array.isArray(p1.programmes) && p1.programmes.length === 10
    && p1.page === 1 && p1.per === 10, JSON.stringify([p1.programmes && p1.programmes.length, p1.page, p1.per]));
  check('with the total beside it', p1.total > 10, p1.total);
  check('and the counts the tiles show, from the database', p1.stats && p1.stats.total === p1.total
    && p1.stats.onSite + p1.stats.searchOnly + p1.stats.hidden === p1.stats.total, JSON.stringify(p1.stats));
  check('and the field list with counts', Array.isArray(p1.fields) && p1.fields.length > 3 && p1.fields.every(f => f.field && f.n > 0));
  const p2 = await get('/api/staff/catalogue?per=10&page=2');
  check('page two is different rows', p2.programmes.length === 10
    && !p2.programmes.some(a => p1.programmes.some(b => b.id === a.id)));
  const de = await get('/api/staff/catalogue?country=DE&per=500');
  check('a country filter counts only that country', de.total === de.programmes.length
    && de.programmes.every(p => p.country === 'DE') && de.total === p1.stats.total - (await get('/api/staff/catalogue?per=1')).countries
      .filter(c => c.code !== 'DE').reduce((n, c) => n + c.programmes, 0), de.total);
  const q = await get('/api/staff/catalogue?q=munich&per=500');
  check('a word search finds the rows through the index', q.total > 0 && q.programmes.every(p =>
    /munich|münchen/i.test(p.university + ' ' + p.city + ' ' + p.program + ' ' + p.field)), q.total);
  const pub = await get('/api/staff/catalogue?type=pub&per=500');
  check('the public/private filter is answered by the database', pub.total > 0 && pub.programmes.every(p => p.isPublic), pub.total);
  const live = await get('/api/staff/catalogue?status=1&per=1');
  check('the status filter counts what the tiles count', live.total === p1.stats.onSite, live.total + ' vs ' + p1.stats.onSite);
  const cg = await get('/api/staff/catalogue?cgpa=6&per=500');
  const cgAll = await get('/api/staff/catalogue?cgpa=10&per=1');
  check('the CGPA filter leaves out programmes whose bar is above the number', cg.total < cgAll.total && cgAll.total === p1.total,
    cg.total + ' at 6.0, ' + cgAll.total + ' at 10');

  /* What "select all" covers: the ids the same filters match. */
  const ids = await get('/api/staff/catalogue/ids?country=DE');
  check('select-all asks for the ids the search found', ids.ids.length === de.total && ids.total === de.total, ids.ids.length);

  /* --------------------------------------------------- university pages */
  const u1 = await get('/api/staff/universities?per=5');
  check('the university list is a page with a total', u1.universities.length === 5 && u1.total > 5 && u1.page === 1, JSON.stringify([u1.universities.length, u1.total]));
  const uq = await get('/api/staff/universities?q=munich');
  check('and is searched by the database', uq.total >= 1 && uq.universities.every(u => /munich|münchen/i.test(u.name + ' ' + u.shortName + ' ' + u.city)), uq.total);
  check('each with what the tab prints', u1.universities.every(u => u.slug && u.name && typeof u.programmes === 'number' && 'listed' in u && u.feeModel));

  /* --------------------------------------------------------- the sheet */
  const csvDe = await (await ctx.request.get(BASE + '/api/staff/catalogue.csv?country=DE')).text();
  const csvAll = await (await ctx.request.get(BASE + '/api/staff/catalogue.csv')).text();
  check('the sheet download takes a country', csvDe.split('\n').length - 1 <= de.total + 1 && csvDe.split('\n').length < csvAll.split('\n').length
    && !/,GB,|,IE,/.test(csvDe), (csvDe.split('\n').length - 1) + ' lines for ' + de.total);
  const xl = await ctx.request.get(BASE + '/api/staff/catalogue.xlsx?country=DE');
  check('as Excel too', xl.status() === 200 && /spreadsheetml/.test(xl.headers()['content-type']));

  /* ------------------------------------------------------------ the blog */
  const posts = await get('/api/staff/posts?per=3');
  check('the office\'s post list is a page with a total and the tile counts', posts.posts.length <= 3 && posts.total >= posts.posts.length
    && posts.stats && typeof posts.stats.live === 'number' && typeof posts.stats.words === 'number', JSON.stringify(posts.stats));
  const pubOnly = await get('/api/staff/posts?status=published&per=100');
  /* stats.live also counts drafts whose original page is still on disk. */
  check('filtered to the published ones', pubOnly.posts.every(p => p.status === 'published') && pubOnly.total <= posts.stats.live, pubOnly.total + ' vs ' + posts.stats.live);
  const pq = await get('/api/staff/posts?q=germany&per=100');
  check('and searched by headline', pq.total > 0 && pq.posts.every(p => /germany/i.test(p.title + ' ' + p.slug + ' ' + p.tag)), pq.total);
  check('without the bodies', pq.posts.every(p => p.body === undefined && typeof p.words === 'number'));
  const pubApi = await get('/api/posts?per=2');
  check('the public post list is paged too', pubApi.posts.length <= 2 && pubApi.total >= pubApi.posts.length && pubApi.page === 1);

  /* /blog: the first page, and a second one that says so. */
  const guest = await browser.newContext();
  const b1 = await (await guest.request.get(BASE + '/blog')).text();
  check('/blog answers', /<a class="postcard"/.test(b1));
  const beyond = await guest.request.get(BASE + '/blog?page=999');
  check('a page past the end is a 404, not an empty page', beyond.status() === 404);
  const b1again = await (await guest.request.get(BASE + '/blog?page=1')).text();
  check('?page=1 is the front page', /rel="canonical" href="[^"]*\/blog"/.test(b1again));

  /* Where there are more than a page of posts, the page links appear. Made
     so here by publishing a run of small posts, then taken down again. */
  const made = [];
  for (let i = 0; i < 26; i++) {
    const r = await (await ctx.request.post(BASE + '/api/staff/posts', { data: {
      title: 'Scale test post ' + i, body: 'Words enough to be a post. '.repeat(20), status: 'published', tag: 'Scale' } })).json();
    if (r.post) made.push(r.post);
  }
  const b2 = await (await guest.request.get(BASE + '/blog')).text();
  const cards = (b2.match(/<a class="postcard"/g) || []).length;
  check('the front page holds a page of posts, not all of them', cards <= 24 + 8 && /Older posts/.test(b2), cards + ' cards');
  const pg2 = await (await guest.request.get(BASE + '/blog?page=2')).text();
  check('and the second page follows, with a canonical of its own', /<a class="postcard"/.test(pg2)
    && /rel="canonical" href="[^"]*\/blog\?page=2"/.test(pg2) && /Newer posts/.test(pg2));
  const map = await (await guest.request.get(BASE + '/sitemap.xml')).text();
  check('every published post is in the sitemap', made.length === 26 && made.every(p => map.includes('/post/' + p.slug + '</loc>')),
    made.filter(p => map.includes('/post/' + p.slug + '</loc>')).length);
  for (const p of made) { await ctx.request.delete(BASE + '/api/staff/post/' + p.id); await ctx.request.delete(BASE + '/api/staff/post/' + p.id); }
  const after = await get('/api/staff/posts?q=scale%20test&per=100');
  check('taken down again', after.total === 0, after.total);

  /* ------------------------------------------- the screen draws a page */
  const page = await ctx.newPage();
  await page.goto(BASE + '/catalogue.html');
  await page.waitForSelector('#progRows [data-edit]');
  const drawn = await page.$$eval('#progRows tr', r => r.filter(x => x.querySelector('[data-edit]')).length);
  check('the office table draws at most a hundred rows', drawn > 0 && drawn <= 100, drawn);
  check('and says how many there are in all', (await page.textContent('#nProg')).trim() === String(p1.total), await page.textContent('#nProg'));
  await page.fill('#q', 'munich');
  await page.waitForTimeout(700);
  const found = await page.$$eval('#progRows tr', r => r.filter(x => x.querySelector('[data-edit]')).length);
  check('typing a word asks the database', found === Math.min(100, q.total), found + ' vs ' + q.total);
  await page.check('#selAll');
  await page.waitForTimeout(900);
  check('select-all covers what the search found', (await page.textContent('#bulkCount')).indexOf(q.total + ' selected') === 0,
    await page.textContent('#bulkCount'));

  await browser.close();
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log(ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
