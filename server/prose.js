'use strict';
/**
 * What the office types, turned into what a reader sees.
 *
 * A blog editor that wants HTML is a blog editor that only a developer uses,
 * and a rich-text box that emits its own markup is a way to get a <font> tag
 * into a page in 2026. So the box takes text with four conventions, all of
 * which somebody typing a WhatsApp message already knows:
 *
 *   ## Heading            a heading. ### for a smaller one.
 *   - item                a list. Consecutive lines make one list.
 *   1. item               a numbered list.
 *   > line                a pull quote.
 *   [words](https://…)    a link. Only http(s) and same-site paths.
 *   **bold**  *italic*    what they look like.
 *
 * Everything is escaped FIRST and marked up second, so a post that contains
 * <script> renders the characters < s c r i p t and cannot do anything. This is
 * the whole reason the renderer is here rather than in a browser: the same
 * function produces the page Google reads and the preview the writer sees, and
 * neither can be talked into running something.
 */

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* A link we are willing to print. Anything else keeps its words and loses its
   href — `javascript:` in a blog post is a stored XSS with a byline. */
function safeHref(url) {
  const u = String(url || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  /* Same-site: an absolute path, or a page relative to this one. The posts sit
     in /post/, so every link the office writes to another page on the site
     starts `../` — the first version rejected exactly those. */
  if (/^\/[^/\\]/.test(u)) return u;
  if (/^(?:\.\.\/)?[a-z0-9][\w./-]*\.html(?:#[\w-]*)?$/i.test(u) && !u.includes('../../')) return u;
  if (/^#[\w-]+$/.test(u)) return u;
  if (/^mailto:[^\s<>"]+$/i.test(u)) return u;
  return '';
}

/* Inline marks, applied to text that is ALREADY escaped. */
function inline(t) {
  return t
    /* The href may itself contain brackets — Wikipedia URLs do, and so does
       `javascript:alert(1)`, which is the one that matters: matching to the
       first `)` left the tail of it sitting in the sentence. */
    .replace(/\[([^\]]{1,120})\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)\)/g, (m, words, url) => {
      const href = safeHref(url.replace(/&amp;/g, '&'));
      if (!href) return words;
      const out = /^https?:\/\//i.test(href) && !/glovels\.com/i.test(href);
      return '<a href="' + esc(href) + '"'
        + (out ? ' target="_blank" rel="noopener nofollow"' : '') + '>' + words + '</a>';
    })
    .replace(/\*\*([^*]{1,200})\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]{1,200})\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
}

/** Post body → HTML. */
function render(body) {
  const lines = esc(String(body || '')).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;                      // 'ul' | 'ol' | null
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push('<p>' + inline(para.join(' ')) + '</p>');
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push('</' + list + '>');
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) { flushPara(); flushList(); continue; }

    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      const level = Math.min(h[1].length, 4);       // ## -> h2, ### -> h3
      out.push('<h' + level + '>' + inline(h[2]) + '</h' + level + '>');
      continue;
    }

    const q = /^&gt;\s?(.*)$/.exec(line);           // escaped already
    if (q) {
      flushPara(); flushList();
      out.push('<blockquote><p>' + inline(q[1]) + '</p></blockquote>');
      continue;
    }

    const ul = /^[-*+]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { flushList(); out.push('<' + want + '>'); list = want; }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>');
      continue;
    }

    if (list) { flushList(); }
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}

/** Words a reader gets through in a minute, near enough, and never zero. */
function readingMinutes(body) {
  const words = String(body || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * The first plain sentence or two, for when nobody wrote an excerpt.
 *
 * A meta description that is empty is a search result with a sentence Google
 * picked, and a description that is 400 characters is one it truncates. Both
 * are worse than the first two sentences of the article.
 */
function summarise(body, limit) {
  const cap = limit || 155;
  const flat = String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter(l => !/^\s*(#{2,4}|[-*+]\s|\d+[.)]\s|>)/.test(l))
    .join(' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= cap) return flat;
  const cut = flat.slice(0, cap);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop > cap * 0.5) return cut.slice(0, stop + 1).trim();
  return cut.slice(0, cut.lastIndexOf(' ')).trim() + '…';
}

/** A title turned into a URL nobody has to think about. */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';
}

module.exports = { render, readingMinutes, summarise, slugify, esc, safeHref };
