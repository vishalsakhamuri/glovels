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
 *     - item              indent it and it nests inside the one above.
 *   > line                a pull quote.
 *   [words](https://…)    a link. Only http(s) and same-site paths.
 *   ![what it shows](…)   a picture. The words in the brackets are the alt text.
 *   | a | b |             a table, with |---|---| under the header row.
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

/* A picture we are willing to print.
 *
 * Same rules as a link, minus `mailto:` and `#anchor` — neither is an image —
 * plus the file having an image extension, so a `.html` page cannot be dropped
 * into an <img> and served as one. A data: URI is refused: it is the shape an
 * SVG payload arrives in. */
function safeImg(url) {
  const u = String(url || '').trim();
  if (!/\.(?:jpe?g|png|gif|webp|avif|svg)(?:\?[^\s"'<>]*)?$/i.test(u)) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/[^/\\]/.test(u)) return u;
  if (/^(?:\.\.\/)?[a-z0-9][\w./-]*$/i.test(u) && !u.includes('../../')) return u;
  return '';
}

/* Inline marks, applied to text that is ALREADY escaped. */
function inline(t) {
  return t
    /* Pictures FIRST. `![alt](url)` contains `[alt](url)`, so letting the link
       rule see it first turns a picture into a link with a stray `!` in front
       of it — which is exactly what the first version did.

       The alt text is not optional and not decoration. It is what a blind
       reader is told the picture shows, what Google reads, and what appears
       when the file 404s. An empty one renders the picture with an empty alt,
       which at least tells a screen reader to skip it rather than reading out
       a filename. */
    .replace(/!\[([^\]]{0,180})\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)(?:\s+&quot;([^&]{1,160})&quot;)?\)/g,
      (m, alt, url, cap) => {
        const src = safeImg(url.replace(/&amp;/g, '&'));
        if (!src) return alt;
        return '<img src="' + esc(src) + '" alt="' + alt + '" loading="lazy"'
          + ' decoding="async"' + (cap ? ' title="' + cap + '"' : '') + '>';
      })
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

/* How far in a line starts, in spaces. A tab is four, because somebody
   indenting a sub-bullet presses Tab as often as they press space and the two
   must nest the same way. */
const indentOf = s => {
  const lead = /^[ \t]*/.exec(s)[0];
  return lead.replace(/\t/g, '    ').length;
};

/* A table's separator row: |---|---| , with :--- and ---: for alignment. */
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/* One row of a table into its cells. A leading and trailing pipe are optional,
   which is what everybody types, and an empty cell stays an empty cell. */
const cellsOf = row => String(row).trim().replace(/^\|/, '').replace(/\|$/, '')
  .split('|').map(c => c.trim());

const alignOf = spec => {
  const s = String(spec).trim();
  if (/^:.*:$/.test(s)) return ' style="text-align:center"';
  if (/:$/.test(s)) return ' style="text-align:right"';
  return '';
};

/** Post body → HTML. */
function render(body) {
  const lines = esc(String(body || '')).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  /* One entry per open list, innermost last: {tag, indent}. A single variable
     could only ever hold one list, which is why nesting did not work. */
  const stack = [];
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push('<p>' + inline(para.join(' ')) + '</p>');
    para = [];
  };
  /* Close every list indented further in than `indent`. A nested list lives
     INSIDE the <li> above it — the `</li>` was taken off when it opened, so it
     goes back on when it closes, or the markup is a list floating between two
     items and every browser guesses differently. */
  const closeTo = indent => {
    while (stack.length && stack[stack.length - 1].indent > indent) {
      const top = stack.pop();
      out.push('</' + top.tag + '>');
      if (stack.length) out.push('</li>');
    }
  };
  const flushList = () => {
    while (stack.length) {
      const top = stack.pop();
      out.push('</' + top.tag + '>');
      if (stack.length) out.push('</li>');
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
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

    /* A table. Only when the NEXT line is the |---|---| separator: a sentence
       with a pipe in it ("Pass | Fail") is a sentence, and turning it into a
       one-cell table would be a surprise nobody asked for. */
    if (line.includes('|') && i + 1 < lines.length && SEP.test(lines[i + 1])
        && !SEP.test(line)) {
      flushPara(); flushList();
      const head = cellsOf(line);
      const align = cellsOf(lines[i + 1]).map(alignOf);
      const rows = [];
      let j = i + 2;
      for (; j < lines.length; j++) {
        const r = lines[j].trim();
        if (!r || !r.includes('|')) break;
        rows.push(cellsOf(r));
      }
      i = j - 1;
      /* The wrapper is not decoration: a five-column table of fees is wider
         than a phone, and without something to scroll it the whole PAGE
         scrolls sideways and the article's left edge goes off screen. */
      out.push('<div class="tablewrap"><table><thead><tr>'
        + head.map((c, n) => '<th' + (align[n] || '') + '>' + inline(c) + '</th>').join('')
        + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + head.map((_, n) =>
            '<td' + (align[n] || '') + '>' + inline(r[n] == null ? '' : r[n]) + '</td>')
          .join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }

    /* A picture on a line of its own becomes a figure, with the caption under
       it when one was written. Inside a sentence it stays inline. */
    const fig = /^!\[([^\]]{0,180})\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)(?:\s+&quot;([^&]{1,160})&quot;)?\)$/
      .exec(line);
    if (fig && safeImg(fig[2].replace(/&amp;/g, '&'))) {
      flushPara(); flushList();
      out.push('<figure>' + inline(line)
        + (fig[3] ? '<figcaption>' + fig[3] + '</figcaption>' : '') + '</figure>');
      continue;
    }

    const ul = /^[-*+]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      const indent = indentOf(raw);
      const top = stack[stack.length - 1];

      if (!top) {
        out.push('<' + want + '>');
        stack.push({ tag: want, indent });
      } else if (indent > top.indent) {
        /* Indented further than the item above: it belongs inside it. Take the
           `</li>` off so the new list opens within that item. */
        if (out.length && /<\/li>$/.test(out[out.length - 1])) {
          out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, '');
        }
        out.push('<' + want + '>');
        stack.push({ tag: want, indent });
      } else {
        closeTo(indent);
        const now = stack[stack.length - 1];
        if (!now) {
          out.push('<' + want + '>');
          stack.push({ tag: want, indent });
        } else if (now.tag !== want) {
          /* Same level, other kind — bullets becoming numbers. One list ends
             and another starts; running them together would put an <li> in a
             list of the wrong type. */
          stack.pop();
          out.push('</' + now.tag + '>');
          if (stack.length) out.push('</li>');
          out.push('<' + want + '>');
          stack.push({ tag: want, indent: now.indent });
        }
      }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>');
      continue;
    }

    /* A bullet that wrapped in the source.
     *
     * Every line was treated as its own thing, so a list item written across
     * two lines — which is what happens the moment anybody wraps at eighty
     * columns — put its second half OUTSIDE the list, as a paragraph between
     * two bullets. It reads as a typesetting fault and it was in every post
     * with a long bullet in it.
     *
     * An indented line while a list is open belongs to the item above it.
     * Unindented, it is a new paragraph and the list has ended, which is what
     * somebody writing prose after a list intends. A line that is indented AND
     * starts with a bullet was handled above: that one nests. */
    if (stack.length && /^\s/.test(raw) && out.length && /<\/li>$/.test(out[out.length - 1])) {
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ' ' + inline(line) + '</li>');
      continue;
    }

    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}

/** Every picture in a post, in the order they appear. */
function images(body) {
  const found = [];
  const re = /!\[([^\]]{0,180})\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)(?:\s+"[^"]{1,160}")?\)/g;
  let m;
  while ((m = re.exec(String(body || '')))) {
    const src = safeImg(m[2]);
    if (src) found.push({ src, alt: m[1] });
  }
  return found;
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
    /* Headings, bullets, quotes, table rows and pictures are not sentences. A
       description that opens "| Country | Tuition |" is a search result nobody
       clicks. */
    .filter(l => !/^\s*(#{2,4}|[-*+]\s|\d+[.)]\s|>|\||!\[)/.test(l))
    /* An indented line is the second half of a bullet or a nested item. Neither
       is prose, and both read as a fragment when Google prints them. */
    .filter(l => !/^[ \t]/.test(l))
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
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

module.exports = {
  render, readingMinutes, summarise, slugify, esc, safeHref, safeImg, images,
};
