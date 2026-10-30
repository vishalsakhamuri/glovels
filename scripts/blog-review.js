#!/usr/bin/env node
'use strict';
/*
 * Round 178 (B3/B4): which blog posts to look at before go-live.
 *
 * Signs in to the new site as a member of staff, reads every post through
 * the office's own list (GET /api/staff/posts, 500 at a time, every status),
 * and prints TWO lists:
 *
 *   1. TEST / DUMMY posts — headline or address says test, testing, demo,
 *      sample, lorem, dummy…, or the post has no words. Archive these.
 *   2. OFF-TOPIC posts — playlists, foods, hiking, movies… The admin decides
 *      for each: keep, keep but noindex, 301 to a related guide, or archive.
 *
 * It changes NOTHING. Archiving is done on the Blog screen: Review → tick →
 * "Archive selected" (never a delete; an archived address 301s to /blog).
 *
 * Run from the repository folder, with Node 18 or newer:
 *
 *   GLOVELS_EMAIL=you@glovels.com GLOVELS_PASSWORD='…' \
 *     node scripts/blog-review.js https://glovels.onrender.com
 *
 * (after the domain moves, the address is https://www.glovels.com). It also
 * writes blog-review-<date>.csv beside where it is run, for a spreadsheet.
 * --json prints the lists as JSON instead.
 */
const fs = require('fs');
const path = require('path');
const REVIEW = require(path.join(__dirname, '..', 'server', 'blogreview.js'));

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const base = String(args.find(a => /^https?:\/\//.test(a)) || process.env.BASE || 'https://glovels.onrender.com').replace(/\/+$/, '');
const email = process.env.GLOVELS_EMAIL || '';
const password = process.env.GLOVELS_PASSWORD || '';

async function main() {
  if (!email || !password) {
    console.error('Set GLOVELS_EMAIL and GLOVELS_PASSWORD (a staff account with access to the website).');
    process.exit(2);
  }
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }), redirect: 'manual',
  });
  if (!login.ok) {
    console.error('Sign-in refused (' + login.status + '): ' + (await login.text()).slice(0, 200));
    process.exit(1);
  }
  const set = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get('set-cookie') || ''])
    .map(c => String(c).split(';')[0]).filter(c => /^glovels_session=/.test(c));
  if (!set.length) { console.error('Signed in, but no session cookie came back.'); process.exit(1); }
  const cookie = set.join('; ');

  const posts = [];
  for (let page = 1; page <= 200; page++) {
    const r = await fetch(base + '/api/staff/posts?per=500&page=' + page, { headers: { cookie } });
    if (!r.ok) { console.error('Could not read the posts (' + r.status + '): ' + (await r.text()).slice(0, 200)); process.exit(1); }
    const j = await r.json();
    posts.push(...(j.posts || []));
    if (!j.posts || j.posts.length < 500 || posts.length >= (j.total || 0)) break;
  }
  const l = REVIEW.lists(posts);
  if (asJson) {
    process.stdout.write(JSON.stringify(Object.assign({ base, checked: posts.length }, l), null, 2) + '\n');
  } else {
    process.stdout.write(posts.length + ' posts checked on ' + base + '\n\n' + REVIEW.asText(l, base));
  }
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = ['list,id,title,address,status,words,reason,decision']
    .concat(l.test.map(x => ['test', x.id, x.title, base + x.url, x.status, x.words, x.reason, 'archive'].map(q).join(',')))
    .concat(l.offTopic.map(x => ['off-topic', x.id, x.title, base + x.url, x.status, x.words, x.reason, ''].map(q).join(',')))
    .join('\n') + '\n';
  const out = 'blog-review-' + new Date().toISOString().slice(0, 10) + '.csv';
  try { fs.writeFileSync(out, csv); if (!asJson) console.log('\nWritten: ' + path.resolve(out)); } catch (e) { /* stdout is enough */ }
}

main().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
