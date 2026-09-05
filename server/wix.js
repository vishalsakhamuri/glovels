'use strict';
/*
 * The blog that is on glovels.com today, brought across.
 *
 * glovels.com is a Wix site with about a hundred and twenty posts on it. The
 * new site had six, written fresh, and no way to bring the rest over short of
 * somebody pasting a hundred and twenty articles into the editor by hand and
 * re-uploading every picture. When the domain moves, every one of those Wix
 * addresses — /post/<slug> — is a link Google has indexed and students have
 * shared, and a site that answers 404 to all of them on day one has thrown
 * away the only search traffic the business has.
 *
 * So this reads the old site the way a browser does and writes what it finds
 * into the posts table, as DRAFTS, with the same slug:
 *
 *   1. /blog-posts-sitemap.xml lists every published post. (The RSS feed
 *      stops at 25 and carries no bodies; the sitemap is complete.)
 *   2. Each post page is server-rendered by Wix, so the article is in the HTML
 *      under data-hook="post-description", and the headline, dates, author,
 *      description and hero picture are in the BlogPosting JSON-LD and the
 *      og: tags. No JavaScript has to run.
 *   3. The article's HTML is turned into the text the editor understands —
 *      headings, lists, links, bold, tables, pictures — so that what comes
 *      across can be corrected in the same box as everything else, and is
 *      rendered by the same code, with the same escaping, as a post typed in.
 *   4. Every picture is downloaded from Wix's CDN at full size and stored on
 *      our disk, because the day the Wix subscription lapses those addresses
 *      die and a hundred posts lose their pictures at once.
 *
 * Drafts, not published: the office reads each one and presses Publish. Some
 * of those posts are "Top student playlists" copied five times over, and
 * nobody wants those going live by machine.
 *
 * Nothing here touches a post that already exists at the same address unless
 * told to. A post the office has already rewritten is theirs.
 */

const path = require('path');
const IMAGES = require('./images.js');

const DEFAULT_BASE = 'https://www.glovels.com';
const CDN = 'https://static.wixstatic.com/media/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36 Glovels-import';

/* --------------------------------------------------------------- fetching */

async function get(url, as, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  const res = await f(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  if (as === 'buffer') return Buffer.from(await res.arrayBuffer());
  return res.text();
}

/* ------------------------------------------------------------ the sitemap */

/** Every /post/ address in the blog sitemap, in the order Wix lists them. */
function postUrls(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml))) {
    const u = decodeEntities(m[1]);
    if (/\/post\/[^/]+\/?$/.test(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

const slugOf = u => {
  try {
    return decodeURIComponent(new URL(u).pathname.replace(/\/+$/, '').split('/').pop());
  } catch (e) { return ''; }
};

/* ------------------------------------------------------- a small HTML parser */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', euro: '€', copy: '©', middot: '·',
  bull: '•', times: '×', deg: '°' };

function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
  });
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr']);
const DROP = new Set(['script', 'style', 'svg', 'button', 'noscript', 'template', 'iframe']);

/**
 * HTML → a tree of { tag, attrs, children } with text as strings. It is not
 * a browser: it does not fix bad nesting, it simply closes what is open when
 * a matching end tag arrives, which is enough for markup a CMS generated.
 */
function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {                                   // end tag
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    if (m[2]) {                                   // start tag
      const tag = m[2].toLowerCase();
      const attrs = {};
      const are = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = are.exec(m[3] || ''))) {
        attrs[a[1].toLowerCase()] = decodeEntities(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : '');
      }
      const node = { tag, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!m[4] && !VOID.has(tag)) stack.push(node);
      continue;
    }
    if (m[5]) {
      const top = stack[stack.length - 1];
      if (DROP.has(top.tag)) continue;
      top.children.push(decodeEntities(m[5]));
    }
  }
  return root;
}

const find = (node, pred, out) => {
  out = out || [];
  if (typeof node === 'string') return out;
  if (pred(node)) out.push(node);
  for (const c of node.children) find(c, pred, out);
  return out;
};
const first = (node, pred) => find(node, pred)[0] || null;
const textOf = node => typeof node === 'string' ? node
  : node.children.map(textOf).join('');

/* --------------------------------------------------- HTML → editor text */

/* The picture's own id, from any of the addresses Wix writes it under.
   `564c6b_3edd…~mv2.png` is the file; everything after `/v1/` is a resize. */
const mediaId = s => {
  const m = /([a-f0-9]{6,}_[a-f0-9]{16,}~mv2(?:_d_\d+_\d+_s_\d+_\d+)?\.[a-z0-9]+)/i.exec(String(s || ''));
  return m ? m[1] : '';
};

/** The full-size address of a Wix picture, from any resized form of it. */
const fullSize = s => {
  const id = mediaId(s);
  return id ? CDN + id : '';
};

/* The picture inside a Ricos figure: the id is in wow-image's data-image-info,
   which is the one place it appears at full size; the <img> underneath is a
   49-pixel blurred placeholder until JavaScript runs. */
function figureImage(node) {
  const wow = first(node, n => n.tag === 'wow-image');
  if (wow && wow.attrs['data-image-info']) {
    try {
      const info = JSON.parse(wow.attrs['data-image-info']);
      const d = info.imageData || info;
      if (d && d.uri) return { src: CDN + d.uri, alt: (d.alt || d.name || '').trim() };
    } catch (e) { /* fall through to the img */ }
  }
  const img = first(node, n => n.tag === 'img');
  if (img) {
    const src = fullSize(img.attrs.src || img.attrs['data-src'] || img.attrs['data-pin-media'])
      || img.attrs.src || '';
    return src ? { src, alt: (img.attrs.alt || '').trim() } : null;
  }
  return null;
}

const collapse = s => s.replace(/[ \t\r\n ]+/g, ' ');

/** Inline content of a node as editor text. */
function inlineOf(node, ctx) {
  if (typeof node === 'string') return collapse(node);
  const t = node.tag;
  if (DROP.has(t)) return '';
  if (t === 'br') return '\n';
  if (t === 'img' || t === 'wow-image' || t === 'figure') {
    const im = figureImage(node);
    if (!im) return '';
    ctx.images.push(im.src);
    return '![' + (im.alt || '').replace(/[\[\]]/g, '') + '](' + im.src + ')';
  }
  const inner = node.children.map(c => inlineOf(c, ctx)).join('');
  if (t === 'a') {
    const href = (node.attrs.href || '').trim();
    const words = inner.trim();
    if (!words) return '';
    if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) return words;
    /* Links that pointed back at the old site point at the same address on
       this one — the slugs are kept, so /post/x is still /post/x. */
    const local = /^https?:\/\/(?:www\.)?glovels\.com(\/[^\s]*)?$/i.exec(href);
    const to = local ? (local[1] || '/') : href;
    return '[' + words.replace(/[\[\]]/g, '') + '](' + to + ')';
  }
  if (t === 'strong' || t === 'b') {
    const w = inner.trim();
    return w ? ' **' + w + '** ' : '';
  }
  if (t === 'em' || t === 'i') {
    const w = inner.trim();
    return w ? ' *' + w + '* ' : '';
  }
  return inner;
}

const tidyInline = s => s.replace(/ +\n/g, '\n').replace(/\n +/g, '\n')
  .replace(/ {2,}/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').trim();

/** Block content of a node as editor text: paragraphs separated by blank lines. */
function blocksOf(node, ctx, depth) {
  depth = depth || 0;
  const out = [];
  for (const c of node.children) {
    if (typeof c === 'string') {
      if (c.trim()) out.push(tidyInline(collapse(c)));
      continue;
    }
    const t = c.tag;
    if (DROP.has(t)) continue;
    if (/^h[1-6]$/.test(t)) {
      const words = tidyInline(inlineOf(c, ctx));
      /* Wix lets a writer use H1 inside the body; on our page the headline is
         the only H1, so every body heading steps down to ## or ###. */
      if (words) out.push((t === 'h1' || t === 'h2' ? '## ' : '### ') + words);
    } else if (t === 'p') {
      const words = tidyInline(inlineOf(c, ctx));
      if (words) out.push(words);
    } else if (t === 'ul' || t === 'ol') {
      out.push(listOf(c, ctx, depth));
    } else if (t === 'blockquote') {
      const words = tidyInline(blocksOf(c, ctx, depth).replace(/\n{2,}/g, '\n'));
      if (words) out.push(words.split('\n').map(l => '> ' + l).join('\n'));
    } else if (t === 'table') {
      out.push(tableOf(c, ctx));
    } else if (t === 'figure' || t === 'img' || t === 'wow-image') {
      const im = figureImage(c);
      if (im) {
        ctx.images.push(im.src);
        const cap = tidyInline(find(c, n => n.tag === 'figcaption').map(n => inlineOf(n, ctx)).join(' '));
        /* The caption goes inside the brackets — `![alt](src "caption")` —
           which is where the renderer reads it. */
        out.push('![' + (im.alt || '').replace(/[\[\]]/g, '') + '](' + im.src
          + (cap ? ' "' + cap.replace(/"/g, '”') + '"' : '') + ')');
      }
    } else if (t === 'hr') {
      /* nothing — the editor has no rule, and a blank line reads the same */
    } else if (t === 'li') {
      out.push(listOf({ tag: 'ul', attrs: {}, children: [c] }, ctx, depth));
    } else {
      /* div, section, span at block level, and everything Wix wraps things
         in: look through it. */
      const inner = blocksOf(c, ctx, depth);
      if (inner) out.push(inner);
    }
  }
  return out.filter(Boolean).join('\n\n');
}

function listOf(list, ctx, depth) {
  const ordered = list.tag === 'ol';
  const pad = '  '.repeat(depth);
  const lines = [];
  let n = 0;
  for (const li of list.children) {
    if (typeof li === 'string' || li.tag !== 'li') continue;
    n++;
    const nested = [];
    const own = [];
    for (const c of li.children) {
      if (typeof c !== 'string' && (c.tag === 'ul' || c.tag === 'ol')) nested.push(c);
      else own.push(c);
    }
    const words = tidyInline(own.map(c => typeof c === 'string' ? collapse(c)
      : (c.tag === 'p' || c.tag === 'div') ? inlineOf(c, ctx) + ' ' : inlineOf(c, ctx)).join(''))
      .replace(/\n+/g, ' ');
    lines.push(pad + (ordered ? n + '. ' : '- ') + words);
    for (const sub of nested) lines.push(listOf(sub, ctx, depth + 1));
  }
  return lines.join('\n');
}

function tableOf(table, ctx) {
  const rows = find(table, n => n.tag === 'tr').map(tr =>
    tr.children.filter(c => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'))
      .map(td => tidyInline(inlineOf(td, ctx)).replace(/\n+/g, ' ').replace(/\|/g, '/')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map(r => r.length));
  const line = r => '| ' + Array.from({ length: width }, (_, i) => r[i] || '').join(' | ') + ' |';
  return [line(rows[0]), '|' + ' --- |'.repeat(width)].concat(rows.slice(1).map(line)).join('\n');
}

/* ---------------------------------------------------------- one post page */

/** Read a Wix post page into the shape the editor saves. */
function readPost(html, url) {
  const doc = parse(html);
  const meta = name => {
    const n = first(doc, x => x.tag === 'meta'
      && (x.attrs.property === name || x.attrs.name === name));
    return n ? String(n.attrs.content || '').trim() : '';
  };
  /* The BlogPosting JSON-LD, read from the source: the parser keeps script
     text out of the tree on purpose. */
  let ld = null;
  const at = html.indexOf('"@type":"BlogPosting"');
  if (at >= 0) {
    const start = html.lastIndexOf('<script', at);
    const end = html.indexOf('</script>', at);
    try { ld = JSON.parse(html.slice(html.indexOf('>', start) + 1, end)); } catch (e) { ld = null; }
  }

  const body = first(doc, x => x.attrs['data-hook'] === 'post-description');
  const ctx = { images: [] };
  const text = body ? blocksOf(body, ctx) : '';

  const title = decodeEntities((ld && ld.headline) || meta('og:title')
    || textOf(first(doc, x => x.tag === 'h1') || '').trim());
  const cover = fullSize(meta('og:image') || (ld && ld.image && (ld.image.url || ld.image)) || '');
  if (cover) ctx.images.unshift(cover);
  const when = s => { const d = new Date(s || ''); return isNaN(d) ? '' : d.toISOString(); };

  return {
    slug: slugOf(url),
    title: String(title || '').trim().slice(0, 180),
    metaDesc: decodeEntities(meta('description') || (ld && ld.description) || '').slice(0, 320),
    author: decodeEntities((ld && ld.author && ld.author.name) || '').trim().slice(0, 90),
    publishedAt: when(ld && ld.datePublished) || when(meta('article:published_time')),
    cover,
    body: text,
    images: ctx.images.filter((x, i, a) => a.indexOf(x) === i),
    found: !!body,
  };
}

/* -------------------------------------------------------------- the job */

/**
 * Bring every post across. `opts`:
 *   db          the store
 *   imageDir    where pictures go
 *   base        the site to read (a test points this at a stand-in)
 *   fetch       fetch implementation (tests)
 *   overwrite   replace a DRAFT that already has the slug (never a live post)
 *   only        array of slugs — just these
 *   author      byline when the page has none
 *   report      called after every post with the running status
 * Returns the status object, which is also updated in place as it runs.
 */
async function importAll(opts) {
  const base = String(opts.base || DEFAULT_BASE).replace(/\/+$/, '');
  const status = { running: true, startedAt: new Date().toISOString(), total: 0, done: 0,
    created: 0, replaced: 0, skipped: 0, failed: 0, pictures: 0, items: [], error: '' };
  const tell = () => { if (opts.report) try { opts.report(status); } catch (e) {} };
  const cache = new Map();                      // wix address → our address
  /* Every address in the sitemap and every picture names Wix's own hosts. When
     the base is somewhere else — a stand-in in a test — the same paths are
     read from there instead, so the reader is exercised without the internet. */
  const at = u => {
    if (base === DEFAULT_BASE) return u;
    try { return base + new URL(u).pathname; } catch (e) { return u; }
  };

  const bring = async (src, hint) => {
    if (cache.has(src)) return cache.get(src);
    try {
      const buf = await get(at(src), 'buffer', opts.fetch);
      const r = IMAGES.store(opts.imageDir, path.basename(new URL(src).pathname), buf, hint);
      if (r.error) throw new Error(r.error);
      cache.set(src, r.url);
      status.pictures++;
      return r.url;
    } catch (e) {
      /* The post still has a picture — Wix's copy — rather than a hole. It is
         listed so the office knows which ones to re-upload by hand. */
      cache.set(src, src);
      return src;
    }
  };

  try {
    const xml = await get(base + '/blog-posts-sitemap.xml', 'text', opts.fetch);
    let urls = postUrls(xml);
    if (opts.only && opts.only.length) urls = urls.filter(u => opts.only.includes(slugOf(u)));
    status.total = urls.length;
    tell();

    for (const u of urls) {
      const item = { slug: slugOf(u), url: u, result: '', note: '' };
      status.items.push(item);
      try {
        const have = opts.db.postBySlug(item.slug);
        if (have && (have.status === 'published' || !opts.overwrite)) {
          item.result = 'skipped';
          item.note = have.status === 'published' ? 'already live here' : 'already a draft here';
          status.skipped++;
        } else {
          const html = await get(at(u), 'text', opts.fetch);
          const p = readPost(html, u);
          if (!p.found || !p.title) throw new Error('the page had no article on it');
          let body = p.body;
          for (const src of p.images) {
            const ours = await bring(src, 'wix');
            if (ours !== src) body = body.split(src).join(ours);
          }
          const cover = p.cover ? cache.get(p.cover) || p.cover : '';
          const row = {
            slug: item.slug, title: p.title, body,
            excerpt: p.metaDesc || require('./prose.js').summarise(body, 200),
            cover, author: p.author || opts.author || '',
            tag: '', status: 'draft',
            metaTitle: '', metaDesc: p.metaDesc, keywords: '', ogImage: '',
            related: '', readMins: require('./prose.js').readingMinutes(body),
            publishedAt: p.publishedAt, updatedBy: opts.by || 'import',
          };
          if (have) { opts.db.updatePost(have.id, row); item.result = 'replaced'; status.replaced++; }
          else { opts.db.addPost(row); item.result = 'created'; status.created++; }
          const kept = p.images.filter(s => cache.get(s) === s).length;
          if (kept) item.note = kept + ' picture(s) could not be copied and still point at Wix';
        }
      } catch (e) {
        item.result = 'failed';
        item.note = String(e && e.message || e).slice(0, 200);
        status.failed++;
      }
      status.done++;
      tell();
    }
  } catch (e) {
    status.error = 'Could not read ' + base + ': ' + String(e && e.message || e).slice(0, 200);
  }
  status.running = false;
  status.finishedAt = new Date().toISOString();
  tell();
  return status;
}

module.exports = { importAll, readPost, postUrls, parse, blocksOf, fullSize, mediaId,
  decodeEntities, DEFAULT_BASE };
