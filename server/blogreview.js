'use strict';
/*
 * Round 178 (B3/B4) — which blog posts the office should look at before the
 * domain moves: TEST / DUMMY posts (to archive) and OFF-TOPIC ones (the owner
 * decides: keep, keep but noindex, 301 to a guide, or archive).
 *
 * Nothing here changes a post. It sorts a list into two lists with a reason
 * against each one; the office ticks and presses "Archive selected" on the
 * blog screen, and archiving is reversible (status 'archived', never a
 * delete; an archived address 301s to /blog).
 *
 * Used by the API (GET /api/staff/posts/review) and by
 * scripts/blog-review.js, which runs the same rules against the live site
 * from a laptop.
 */

/* A word on its own: "Blog Testing", "demo-post", "lorem ipsum". */
const STRONG = /(?:^|[^a-z])(testing|tested|demo|dummy|sample|lorem|ipsum|asdf|qwerty|placeholder|untitled|test[- ]?post|blog[- ]?test)(?:[^a-z]|$)/i;
/* "test" alone is weaker: an exam guide ("IELTS test dates") is not a test post. */
const WEAK = /(?:^|[^a-z])tests?(?:[^a-z]|$)/i;
const EXAM = /ielts|toefl|pte|gre|gmat|sat\b|testdaf|telc|goethe|duolingo|language|exam|aptitude|entrance|admission test|tests? (?:dates?|centres?|centers?|fees?|scores?|format|pattern|preparation|prep)|english test|german test|test ?as\b|tests?as/i;
/* What a study-abroad expert does not write about. */
const OFF = /playlist|songs?\b|music|movies?\b|netflix|series to watch|foods?\b|dish(?:es)?\b|recipes?|cuisine|restaurants?|street food|snacks?|beers?\b|wine|nightlife|party|parties|hik(?:e|es|ing)\b|trek(?:s|king)?\b|trails?\b|places to visit|tourist|sightseeing|beach(?:es)?|castles?|road ?trip|weekend getaway|fashion|outfits?|shopping|instagram|selfie|horoscope|cricket|football/i;

function norm(p) {
  return {
    id: p.id, slug: String(p.slug || ''), title: String(p.title || ''),
    status: String(p.status || ''), words: Number(p.words || 0),
    publishedAt: p.publishedAt || p.published_at || '', url: '/post/' + String(p.slug || ''),
  };
}

/** One post: { test: reason|'', offTopic: reason|'' }. */
function classify(p) {
  const x = norm(p);
  const hay = x.title + ' ' + x.slug.replace(/-/g, ' ');
  let test = '';
  if (!x.title.trim()) test = 'no headline';
  else if (!x.words) test = 'empty post (no words in the body)';
  else {
    const m = STRONG.exec(hay);
    if (m) test = 'headline/address says "' + m[1].toLowerCase() + '"';
    else if (WEAK.test(hay) && !EXAM.test(hay)) test = 'headline/address says "test" — check: could be a real guide';
  }
  let offTopic = '';
  const o = OFF.exec(hay);
  if (o && !test) offTopic = 'about "' + o[0].toLowerCase() + '" rather than studying abroad';
  return { test, offTopic };
}

/** Every post → { test: [...], offTopic: [...] }, each item with its reason. Archived posts are left out. */
function lists(posts) {
  const test = [], offTopic = [];
  (posts || []).forEach(p => {
    if (String(p.status || '') === 'archived') return;
    const c = classify(p);
    if (c.test) test.push(Object.assign(norm(p), { reason: c.test }));
    else if (c.offTopic) offTopic.push(Object.assign(norm(p), { reason: c.offTopic }));
  });
  return { test, offTopic };
}

/** The two lists as plain text, for a person to read or paste into an email. */
function asText(l, base) {
  const b = String(base || '').replace(/\/+$/, '');
  const row = x => '  - ' + (x.title || '(no headline)') + '\n      ' + b + x.url
    + '  [' + (x.status === 'published' ? 'on the site' : x.status || 'draft') + ', ' + x.words + ' words] — ' + x.reason;
  return 'TEST / DUMMY POSTS (' + l.test.length + ') — archive after the admin agrees\n'
    + (l.test.map(row).join('\n') || '  (none)') + '\n\n'
    + 'OFF-TOPIC POSTS (' + l.offTopic.length + ') — admin decides: keep / keep but noindex / 301 to a guide / archive\n'
    + (l.offTopic.map(row).join('\n') || '  (none)') + '\n';
}

module.exports = { classify, lists, asText };
