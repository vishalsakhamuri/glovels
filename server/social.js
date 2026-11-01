'use strict';
/*
 * Patch 212: PUBLISH ONCE, EVERYWHERE.
 *
 * "We should be able to publish blogs or anything from one place to Insta,
 *  Facebook, push notification and website." — Vishal, 1 Nov
 *
 * A post goes live on the website as it always did; from the same screen it
 * is then shared to:
 *
 *   Facebook   a post on the Glovels Page: the words and the link.
 *   Instagram  the post's cover picture with a caption (Instagram does not
 *              make links in captions clickable, so the caption says where
 *              to read it). No picture, no Instagram — said, not guessed.
 *   Push       a notification to every student who turned them on.
 *
 * Keys, on Render → Environment:
 *   META_PAGE_ID       the Facebook Page's id
 *   META_PAGE_TOKEN    a Page access token with pages_manage_posts (and
 *                      instagram_content_publish for Instagram)
 *   META_IG_USER       the Instagram business account id (for Instagram)
 * Each channel is simply "not connected" until its keys are there.
 */
const https = require('https');
const http = require('http');

const env = k => String(process.env[k] || '').trim();
function request(method, href, form) {
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const body = form ? new URLSearchParams(form).toString() : '';
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method, timeout: 30000, headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {} }, res => {
      let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
        let j = {}; try { j = JSON.parse(out); } catch (e) { j = { raw: out }; }
        resolve({ status: res.statusCode, data: j });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const base = () => env('META_API_BASE') || 'https://graph.facebook.com/v21.0';
const metaErr = r => ((r.data || {}).error || {}).message || ('Meta said ' + r.status);

function status() {
  return {
    facebook: { connected: !!(env('META_PAGE_ID') && env('META_PAGE_TOKEN')) },
    instagram: { connected: !!(env('META_IG_USER') && (env('META_PAGE_TOKEN') || env('META_ACCESS_TOKEN'))) },
  };
}

async function facebook({ message, link }) {
  if (!status().facebook.connected) return { ok: false, error: 'Facebook is not connected — add META_PAGE_ID and META_PAGE_TOKEN on Render.' };
  const r = await request('POST', base() + '/' + env('META_PAGE_ID') + '/feed', { message, link, access_token: env('META_PAGE_TOKEN') });
  return r.status === 200 && r.data.id ? { ok: true, id: r.data.id } : { ok: false, error: metaErr(r) };
}

async function instagram({ imageUrl, caption }) {
  if (!status().instagram.connected) return { ok: false, error: 'Instagram is not connected — add META_IG_USER and META_PAGE_TOKEN on Render.' };
  if (!/^https:\/\//.test(String(imageUrl || ''))) return { ok: false, error: 'Instagram needs a picture — give the post a cover image first.' };
  const token = env('META_PAGE_TOKEN') || env('META_ACCESS_TOKEN');
  const ig = env('META_IG_USER');
  const c = await request('POST', base() + '/' + ig + '/media', { image_url: imageUrl, caption, access_token: token });
  if (c.status !== 200 || !c.data.id) return { ok: false, error: metaErr(c) };
  const p = await request('POST', base() + '/' + ig + '/media_publish', { creation_id: c.data.id, access_token: token });
  return p.status === 200 && p.data.id ? { ok: true, id: p.data.id } : { ok: false, error: metaErr(p) };
}

/** Everyone with notifications on (students), one notification each. */
async function pushAll({ db, push, title, body, url }) {
  if (!push || typeof push.toPerson !== 'function') return { ok: false, error: 'Push notifications are not set up on this server.' };
  const ids = db.pushAudience ? db.pushAudience() : [];
  /* Patch 215 (QA): "shared to 0 people" in green read as success. */
  if (!ids.length) return { ok: false, error: 'Nobody has notifications switched on yet — nothing was sent.' };
  let sent = 0;
  for (const id of ids) {
    try { const r = await push.toPerson(id, { title, body, url, tag: 'news' }); sent += (r && r.sent) || 0; } catch (e) { /* one bad subscription */ }
  }
  return { ok: true, people: ids.length, sent };
}

/**
 * Share one published post. `want` = { facebook, instagram, push }.
 * Returns one line per channel: { ok, id | error }.
 */
async function share({ db, push, siteUrl, post, want }) {
  const url = String(siteUrl || '').replace(/\/$/, '') + '/post/' + post.slug;
  const lead = String(post.excerpt || post.meta_desc || post.metaDesc || '').trim();
  const tags = String(post.keywords || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 5)
    .map(k => '#' + k.replace(/[^A-Za-z0-9]/g, '')).filter(t => t.length > 2).join(' ');
  const out = {};
  if (want.facebook) {
    try { out.facebook = await facebook({ message: post.title + (lead ? '\n\n' + lead : ''), link: url }); }
    catch (e) { out.facebook = { ok: false, error: String(e.message || e) }; }
  }
  if (want.instagram) {
    const img = String(post.cover || post.og_image || post.ogImage || '').trim();
    const abs = /^https:\/\//.test(img) ? img : img && siteUrl ? String(siteUrl).replace(/\/$/, '') + '/' + img.replace(/^\//, '') : '';
    try {
      out.instagram = await instagram({ imageUrl: abs, caption: post.title + (lead ? '\n\n' + lead : '')
        + '\n\nRead it on glovels.com — link in our bio.' + (tags ? '\n\n' + tags : '') });
    } catch (e) { out.instagram = { ok: false, error: String(e.message || e) }; }
  }
  if (want.push) {
    try { out.push = await pushAll({ db, push, title: post.title.slice(0, 80), body: (lead || 'New on Glovels').slice(0, 140), url: '/post/' + post.slug }); }
    catch (e) { out.push = { ok: false, error: String(e.message || e) }; }
  }
  return out;
}

module.exports = { status, share, facebook, instagram, pushAll };
