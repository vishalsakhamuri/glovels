/*
 * Round 172 — "M.Sc" is a degree, not a web address.
 *
 * The public post /post/german-public-universities-low-cgpa has a section
 * "Official programme pages" in which twenty-three programme titles were split
 * in two: "M.Sc" as its own link, to http://M.Sc, and the rest of the title as
 * the real link. Wix's editor auto-links anything shaped like a domain, the
 * import kept every http(s) href, and the renderer printed any http(s) href.
 *
 *  1. The renderer (server/prose.js safeHref → realUrl) prints an http(s) link
 *     only when its host is a real one: localhost/IP, or a known top-level
 *     domain, and never a degree abbreviation. Real links still link.
 *  2. The Wix importer (server/wix.js) applies the same rule on the way in.
 *  3. A one-time start-up repair (seed.repairBlogLinks, keyed
 *     repair:blog-msc-links) rewrites every stored post: a link to nowhere
 *     becomes its words, and a degree cut off from the programme link beside it
 *     is joined back on ("M.Sc" + "Data Science" → one link). Logged per post.
 *
 *   cd tests && bash srv.sh 8114
 *   BASE=http://localhost:8114 node tests/round172blogtest.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const PROSE = require(path.join(ROOT, 'server', 'prose.js'));
const WIX = require(path.join(ROOT, 'server', 'wix.js'));
const SEED = require(path.join(ROOT, 'server', 'seed.js'));
const STORE = require(path.join(ROOT, 'server', 'store.js'));

const BASE = process.env.BASE || 'http://localhost:8114';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + String(e === undefined ? '' : e).slice(0, 300))); };

const JUNK = '[M.Sc](http://M.Sc) [Data Science](https://www.tum.de/en/studies/degree-programs/detail/data-engineering-and-analytics-master-of-science-msc)';
const BODY = [
  '## Why a low CGPA is not the end',
  'Public universities in Germany read the whole profile. '.repeat(12),
  '',
  '## Official programme pages',
  '- ' + JUNK,
  '- [M.Sc](http://M.Sc) [Computational Engineering](https://www.rwth-aachen.de/cms/root/studium/vor-dem-studium/studiengaenge/liste-aktuelle-studiengaenge/studiengangbeschreibung/~bmsu/computational-engineering-science-m-sc/)',
  '- [B.Tech](http://B.Tech) [Mechanical Engineering](https://www.tu-berlin.de/en/mechanical-engineering)',
  '- [M.A](http://M.A) [Economics](https://www.uni-bonn.de/en/economics)',
  '- <a href="http://M.Sc">M.Sc</a> <a href="https://www.lmu.de/en/physics">Physics</a>',
  '- [MBA](MBA) General Management at [ESMT](https://esmt.berlin/)',
  '- M.Sc Data Science at a university we name later',
  '',
  'Read the [DAAD database](https://www2.daad.de/deutschland/studienangebote/international-programmes/en/) and [our fees page](../services.html), or write to [us](mailto:info@glovels.com).',
].join('\n');

(async () => {
  /* ---------------------------------------------------------- 1. the linkifier */
  console.log('1. the renderer: a degree is never a link, a real address always is');
  for (const u of ['http://M.Sc', 'https://M.Sc/', 'http://B.Tech', 'http://M.A', 'http://MBA', 'http://Ph.D', 'http://LL.M', 'https://foo.zq', 'https://foo.cs', 'http://M.Pharm', 'http://B.Arch']) {
    ok('refused: ' + u, !PROSE.realUrl(u) && PROSE.safeHref(u) === '');
  }
  for (const u of ['https://www.tum.de/x?y=1', 'https://x.com/glovels', 'https://t.co/abc', 'http://localhost:8114/post/x', 'https://glovels.example/blog', 'https://example.com', 'https://www2.daad.de/a/b', 'https://esmt.berlin/', 'https://uni.ac.uk/']) {
    ok('kept: ' + u, PROSE.realUrl(u) && PROSE.safeHref(u) === u);
  }
  const html = PROSE.render(BODY);
  ok('rendered: no href="http://M.Sc" (or any degree) anywhere', !/href="https?:\/\/(?:M\.Sc|B\.Tech|M\.A|MBA)/i.test(html), html.match(/href="[^"]*"/g));
  ok('rendered: "M.Sc" is still in the words', /M\.Sc Data Science|M\.Sc<\/a>|M\.Sc <a/.test(html));
  ok('rendered: the real programme links are links', /<a href="https:\/\/www\.tum\.de\/en\/studies\/[^"]+" target="_blank" rel="noopener nofollow">/.test(html)
    && /<a href="https:\/\/www\.rwth-aachen\.de\/[^"]+" target="_blank" rel="noopener nofollow">Computational Engineering<\/a>/.test(html));
  ok('rendered: a same-site link and a mailto still work', /<a href="\.\.\/services\.html">our fees page<\/a>/.test(html) && /<a href="mailto:info@glovels\.com">us<\/a>/.test(html));

  /* ---------------------------------------------------------- 2. the importer */
  console.log('2. the Wix importer applies the same rule on the way in');
  const tree = WIX.parse('<div><p><a href="http://M.Sc">M.Sc</a> <a href="https://www.tum.de/x">Data Science</a> and <a href="https://www.glovels.com/post/abc">our post</a> and <a href="mailto:a@b.de">mail</a></p></div>');
  const text = WIX.blocksOf(tree, { images: [] });
  ok('imported text has the real link, the degree as words', /M\.Sc \[Data Science\]\(https:\/\/www\.tum\.de\/x\)/.test(text), text);
  ok('imported text keeps the same-site link and the mailto', /\[our post\]\(\/post\/abc\)/.test(text) && /\[mail\]\(mailto:a@b\.de\)/.test(text), text);
  ok('and never http://M.Sc', !/M\.Sc\)/.test(text) && !/http:\/\/M\.Sc/.test(text), text);

  /* ---------------------------------------------------------- 3. the repair */
  console.log('3. the start-up repair, on a database of its own');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r172-'));
  const db = STORE.open(dir);
  const a = db.addPost({ slug: 'german-public-universities-low-cgpa', title: 'German public universities with a low CGPA', body: BODY, status: 'published', publishedAt: '2026-10-01T09:00:00.000Z', updatedBy: 'office' });
  const b = db.addPost({ slug: 'clean-post', title: 'Nothing to fix', body: 'A [real link](https://www.lmu.de/en/) and words.', status: 'published' });
  const c = db.addPost({ slug: 'empty-draft', title: 'Empty', body: '', status: 'draft' });
  const before = db.postById(a.id);
  const fixed = SEED.repairBlogLinks({ db });
  ok('the repair reports how many links it took out: 6', fixed === 6, fixed);
  const after = db.postById(a.id);
  ok('the stored body has no link to http://M.Sc (or any degree)', !/\]\(http:\/\/(?:M\.Sc|B\.Tech|M\.A)\)/.test(after.body) && !/href="http:\/\/M\.Sc"/.test(after.body) && !/\]\(MBA\)/.test(after.body), after.body);
  ok('each split title is ONE link with the degree in its words', after.body.includes('- [M.Sc Data Science](https://www.tum.de/en/studies/degree-programs/detail/data-engineering-and-analytics-master-of-science-msc)')
    && after.body.includes('- [M.Sc Computational Engineering](https://www.rwth-aachen.de/')
    && after.body.includes('- [B.Tech Mechanical Engineering](https://www.tu-berlin.de/en/mechanical-engineering)')
    && after.body.includes('- [M.A Economics](https://www.uni-bonn.de/en/economics)'), after.body);
  ok('a raw <a> pair is cleaned the same way', after.body.includes('- [M.Sc Physics](https://www.lmu.de/en/physics)'), after.body);
  ok('a bare "MBA" href became words; the real link beside it stayed', after.body.includes('- MBA General Management at [ESMT](https://esmt.berlin/)'), after.body);
  ok('plain "M.Sc Data Science" text is untouched', after.body.includes('- M.Sc Data Science at a university we name later'));
  ok('the real links at the bottom are byte for byte the same', after.body.includes('[DAAD database](https://www2.daad.de/deutschland/studienangebote/international-programmes/en/) and [our fees page](../services.html), or write to [us](mailto:info@glovels.com)'));
  ok('the post stays published, dated as it was, and "updated on" did not move', after.status === 'published' && after.published_at === before.published_at && after.updated_at === before.updated_at, [after.status, after.published_at, after.updated_at, before.updated_at]);
  ok('the clean post was not written', db.postById(b.id).body === 'A [real link](https://www.lmu.de/en/) and words.' && db.postById(b.id).updated_at === b.updated_at);
  ok('the empty draft is left alone', db.postById(c.id).body === '');
  const key = db.content('repair:blog-msc-links');
  ok('keyed once: repair:blog-msc-links records 6 links in 1 post', key && key.done && key.links === 6 && key.posts === 1 && key.detail['german-public-universities-low-cgpa'] === 6, JSON.stringify(key));
  const logged = db.auditTrail(50);
  ok('logged per post, with the count', logged.some(l => /dead links taken out/.test(l.what || '') && /6 link\(s\).*\/post\/german-public-universities-low-cgpa/.test(l.detail || ''))
    && logged.some(l => /blog links repaired/.test(l.what || '') && /6 link\(s\) in 1 post/.test(l.detail || '')), JSON.stringify(logged.slice(0, 3)));
  db.addPost({ slug: 'late-junk', title: 'Late', body: '[M.Sc](http://M.Sc) [X](https://www.tum.de/)', status: 'draft' });
  ok('a second boot does nothing (already done)', SEED.repairBlogLinks({ db }) === 0);
  ok('  · and the renderer still covers a post written after the repair', !/href="http:\/\/M\.Sc"/.test(PROSE.render('[M.Sc](http://M.Sc) [X](https://www.tum.de/)')));
  try { db.close && db.close(); } catch (e) { /* fine */ }

  /* ---------------------------------------------------------- 4. the live page */
  console.log('4. the public page on ' + BASE);
  const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@glovels.com', password: 'glovels123' }) });
  const ck = (lr.headers.getSetCookie ? lr.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
  const H = { cookie: ck, origin: BASE, 'content-type': 'application/json' };
  const slug = 'german-public-universities-low-cgpa';
  const existing = await (await fetch(BASE + '/api/staff/posts?per=500', { headers: H })).json();
  const mine = (existing.posts || []).find(p => p.slug === slug);
  const payload = { title: 'German public universities with a low CGPA', slug, body: BODY, status: 'published', excerpt: 'Which public universities read the whole profile.', tag: 'Germany' };
  const r = mine
    ? await fetch(BASE + '/api/staff/post/' + mine.id, { method: 'PUT', headers: H, body: JSON.stringify(payload) })
    : await fetch(BASE + '/api/staff/posts', { method: 'POST', headers: H, body: JSON.stringify(payload) });
  const saved = await r.json().catch(() => ({}));
  ok('the post with the junk in it is published', r.status === 200 && saved.post && saved.post.slug === slug, r.status + ' ' + JSON.stringify(saved).slice(0, 200));
  const pub = await fetch(BASE + '/post/' + slug);
  const page = await pub.text();
  ok('/post/' + slug + ' serves', pub.status === 200, pub.status);
  ok('it has no href="http://M.Sc" (nor B.Tech, M.A, MBA)', !/href="https?:\/\/(?:M\.Sc|B\.Tech|M\.A|MBA)\b/i.test(page) && !/href="MBA"/.test(page), (page.match(/href="[^"]*(?:M\.Sc|B\.Tech|MBA)[^"]*"/gi) || []).slice(0, 5));
  ok('"M.Sc" is still printed in the programme titles', /M\.Sc/.test(page));
  ok('the real programme pages are links', /<a href="https:\/\/www\.tum\.de\/en\/studies\/degree-programs\/detail\/[^"]+" target="_blank" rel="noopener nofollow">/.test(page)
    && /<a href="https:\/\/www\.rwth-aachen\.de\/[^"]+" target="_blank" rel="noopener nofollow">/.test(page));
  const full = await (await fetch(BASE + '/api/staff/post/' + (saved.post || {}).id, { headers: H })).json().catch(() => ({}));
  const fullHtml = String((full.post || full).html || '');
  ok('the staff API renders the same html — no http://M.Sc, the real link kept', fullHtml.length > 100 && fullHtml.indexOf('href="http://M.Sc"') < 0 && /href="https:\/\/www\.tum\.de\//.test(fullHtml), fullHtml.slice(0, 200));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
