'use strict';
/*
 * Patch 265: the website in nine languages.
 *
 * "language translation only to the website can be done. this is not
 *  required for database" — Vishal, 4 Nov 2026.
 *
 * What is translated: every page a visitor or a student sees — the words in
 * the page files, the generated pages (blog, destinations, universities, the
 * finder), the student's portal screens, and the emails a student gets. What
 * is not: the catalogue (university and programme names, cities, fields,
 * requirements stay as the office keeps them), student records, and every
 * staff screen, which stay English.
 *
 * How, in one paragraph. English keeps its addresses, so nothing Google has
 * ranked moves; every other language lives under a prefix — /zh/study-in-
 * germany, /ar/blog. A request under a prefix is answered exactly as the
 * English one would be, and the finished HTML goes through translatePage()
 * on its way out: the page is cut into units — a heading, a paragraph with
 * its bold words and links, a button label, a meta description, an alt
 * text — each unit is looked up in the dictionary the translator
 * (server/translate.js) has filled, and the translated unit is written in
 * its place. A unit nobody has translated yet is left in English and queued;
 * the next visitor reads it translated. The same dictionary reaches the
 * browser for the words scripts draw after the page has loaded.
 *
 * The unit is the key. Inline tags inside it are numbered placeholders —
 * "Study in <1>Germany</1> from <2>₹{1}</2>" — so the key is the same
 * whatever the link points at and whatever the number is, and the
 * translation puts the tags and the numbers back where the translator left
 * them. Nothing in a <script>, <style>, <svg>, <code> or <pre> is touched;
 * nor anything under translate="no"; nor anything between the comments
 * <!--i18n:off--> and <!--i18n:on-->, which is how the blog marks a post that
 * has been translated whole.
 */

/* The languages, in the order the picker lists them. English first. */
const LANGS = [
  { code: 'en', name: 'English', native: 'English', dir: 'ltr' },
  { code: 'zh', name: 'Chinese', native: '中文', dir: 'ltr', hreflang: 'zh' },
  { code: 'ar', name: 'Arabic', native: 'العربية', dir: 'rtl' },
  { code: 'es', name: 'Spanish', native: 'Español', dir: 'ltr' },
  { code: 'ru', name: 'Russian', native: 'Русский', dir: 'ltr' },
  { code: 'fr', name: 'French', native: 'Français', dir: 'ltr' },
  { code: 'pt', name: 'Portuguese', native: 'Português', dir: 'ltr' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', dir: 'ltr' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', dir: 'ltr' },
];
const BY_CODE = Object.fromEntries(LANGS.map(l => [l.code, l]));
const CODES = LANGS.map(l => l.code);
const OTHER = CODES.filter(c => c !== 'en');
const PREFIX_RE = new RegExp('^/(' + OTHER.join('|') + ')(?=/|$)');

/* The same hash in the browser (assets/i18n-client.js): two FNV-1a passes
   over the UTF-16 units, sixteen hex characters. Not cryptographic — a key
   for a dictionary, where a collision costs one wrong line, not a secret. */
function hash(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
    b ^= c; b = Math.imul(b, 0x01000193 + 2) >>> 0;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/* Tags that sit inside a line of text rather than starting a new block. */
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'data', 'dfn', 'em', 'i', 'mark', 'q', 's',
  'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'wbr', 'br', 'img', 'del', 'ins', 'nobr', 'font']);
/* Whole elements that are copied through untouched. */
const OPAQUE = new Set(['script', 'style', 'svg', 'textarea', 'pre', 'code', 'kbd', 'samp', 'var', 'math', 'template', 'noscript', 'iframe', 'object', 'video', 'audio', 'canvas']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/* Attributes whose value a person reads. */
const TEXT_ATTRS = ['alt', 'title', 'placeholder', 'aria-label', 'aria-placeholder', 'aria-description', 'data-i18n'];
const META_NAMES = new Set(['description', 'og:title', 'og:description', 'twitter:title', 'twitter:description', 'og:image:alt', 'twitter:image:alt', 'keywords', 'apple-mobile-web-app-title', 'application-name']);

const LETTER = /\p{L}/u;
const TWO_LETTERS = /\p{L}[^\p{L}]*\p{L}/u;
const NUM = /\d[\d,. ]*\d|\d/g;
const MAX_UNIT = 4000;

/* A unit that is not words: an address, an email, a phone, a code, a single
   letter, or something a script reads back (a JSON blob, a hex colour). */
function notWords(key) {
  const t = key.replace(/<\/?\d+\/?>|\{\d+\}/g, '').trim();
  if (!TWO_LETTERS.test(t)) return true;
  if (/^(https?:\/\/|www\.|mailto:|tel:|\/|#)\S*$/i.test(t)) return true;
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(t)) return true;
  if (/^[+\d][\d\s().-]{5,}$/.test(t)) return true;
  if (/^[\[{]/.test(t) && /[\]}]$/.test(t)) return true;
  if (/^#[0-9a-f]{3,8}$/i.test(t)) return true;
  if (/^[A-Z]{2,4}$/.test(t) && t !== 'FAQ') return true;      /* INR, USD, DE, PhD … */
  return false;
}

/* The text of a unit, with its numbers taken out as {1}, {2} … */
function numbered(text, nums) {
  return text.replace(NUM, m => { nums.push(m); return '{' + nums.length + '}'; });
}
function spaces(s) { return s.replace(/\s+/g, ' '); }

/* Scan one attribute list for the attributes we read. Returns [{name, value, start, end}]
   where start/end bound the VALUE inside the quotes. Only quoted values. */
function attrsOf(tag) {
  const out = [];
  const re = /([^\s"'<>\/=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) {
    const name = m[1].toLowerCase();
    const value = m[3] != null ? m[3] : m[4];
    const q = m[2].charAt(0);
    const start = m.index + m[0].indexOf(q) + 1;
    out.push({ name, value, start, end: start + value.length, q });
  }
  return out;
}
function attrValue(attrs, name) { const a = attrs.find(x => x.name === name); return a ? a.value : null; }

/*
 * Cut a page into units.
 *
 * Returns { units, attrs } where each unit is
 *   { key, hash, start, end, parts }    — a run of text (+ inline tags)
 * and each attr is
 *   { key, hash, start, end }           — one attribute value
 * with start/end in the original string. Both lists are in document order
 * and never overlap, so a replacement can be written back right to left.
 */
function segment(html) {
  const units = [], attrs = [];
  const n = html.length;
  let i = 0;
  let off = 0;                    /* <!--i18n:off--> depth */
  const stack = [];               /* open non-inline elements: [name, noTranslate] */
  let noDepth = 0;                /* elements with translate="no" we are inside */
  /* The segment being gathered: parts are {t:'text', s} or {t:'tag', raw, kind} */
  let seg = [];
  let segStart = -1;

  const inNo = () => off > 0 || noDepth > 0;

  /* One unit from a run of parts — or several: a run that is only inline
     elements side by side (a menu of links, a row of chips) is one unit per
     element, and an element that wraps the whole run (<a><b>Title</b></a>)
     is peeled, so "Germany" is the same key wherever it is linked from. */
  function emit(parts) {
    /* trim whitespace-only text at both ends */
    let a = 0, b = parts.length;
    while (a < b && parts[a].t === 'text' && !parts[a].s.trim()) a++;
    while (b > a && parts[b - 1].t === 'text' && !parts[b - 1].s.trim()) b--;
    parts = parts.slice(a, b);
    if (!parts.length) return;
    if (!parts.some(p => p.t === 'text' && LETTER.test(p.s))) return;
    /* Top-level structure: pair each open with its close. */
    const groups = [];       /* {from, to} indexes of a top-level element, or {text:i}, {void:i} */
    const open = [];
    let bareLetters = false;
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      if (p.t === 'text') { if (!open.length && LETTER.test(p.s)) bareLetters = true; if (!open.length) groups.push({ text: k }); continue; }
      if (p.kind === 'open') { open.push({ name: p.name, k }); continue; }
      if (p.kind === 'close') {
        let j = open.length - 1;
        while (j >= 0 && open[j].name !== p.name) j--;
        if (j < 0) { if (!open.length) groups.push({ void: k }); continue; }
        const o = open.splice(j);
        if (!open.length) groups.push({ from: o[0].k, to: k });
        continue;
      }
      if (!open.length) groups.push({ void: k });
    }
    if (open.length) {
      /* an element opened here and closed after a block boundary (a card
         <a> around blocks): treat the open tags as void markers */
      bareLetters = true;
    }
    const elems = groups.filter(g => g.from != null);
    if (!bareLetters && elems.length) {
      elems.forEach(g => emit(parts.slice(g.from + 1, g.to)));
      return;
    }
    unit(parts);
  }

  function unit(parts) {
    const start = parts[0].pos;
    const end = parts[parts.length - 1].pos + parts[parts.length - 1].raw.length;
    const tags = [], nums = [];
    const open = [];
    let key = '';
    for (const p of parts) {
      if (p.t === 'text') { key += numbered(spaces(p.s), nums); continue; }
      if (p.kind === 'open') { tags.push(p.raw); open.push({ name: p.name, n: tags.length }); key += '<' + tags.length + '>'; }
      else if (p.kind === 'close') {
        let j = open.length - 1;
        while (j >= 0 && open[j].name !== p.name) j--;
        if (j >= 0) { const o = open.splice(j, 1)[0]; tags[o.n - 1] = [tags[o.n - 1], p.raw]; key += '</' + o.n + '>'; }
        else { tags.push(p.raw); key += '<' + tags.length + '/>'; }
      } else { tags.push(p.raw); key += '<' + tags.length + '/>'; }
    }
    /* An open tag never closed inside the unit becomes a void placeholder
       — its close is past a block boundary and stays where it is. */
    open.forEach(o => { key = key.replace('<' + o.n + '>', '<' + o.n + '/>'); });
    key = key.trim();
    if (key.length > MAX_UNIT || notWords(key)) return;
    units.push({ key, hash: hash(key), start, end, tags, nums, parent: stack.length ? stack[stack.length - 1][0] : '' });
  }

  function flush() {
    const parts = seg; seg = []; segStart = -1;
    if (!parts.length || inNo()) return;
    emit(parts);
  }

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { seg.push({ t: 'text', s: html.slice(i), pos: i, raw: html.slice(i) }); break; }
    if (lt > i) seg.push({ t: 'text', s: html.slice(i, lt), pos: i, raw: html.slice(i, lt) });
    /* Comment */
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      const end = e < 0 ? n : e + 3;
      const body = html.slice(lt + 4, end - 3).trim();
      if (body === 'i18n:off') { flush(); off++; }
      else if (body === 'i18n:on') { flush(); if (off > 0) off--; }
      else seg.push({ t: 'tag', kind: 'void', raw: html.slice(lt, end), pos: lt, name: '!--' });
      i = end; continue;
    }
    /* Doctype, CDATA and the like */
    if (html.charAt(lt + 1) === '!' || html.charAt(lt + 1) === '?') {
      const e = html.indexOf('>', lt); const end = e < 0 ? n : e + 1;
      flush(); i = end; continue;
    }
    /* A tag */
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 40));
    if (!m) { seg.push({ t: 'text', s: '<', pos: lt, raw: '<' }); i = lt + 1; continue; }
    const closing = !!m[1];
    const name = m[2].toLowerCase();
    /* Find the end of the tag, respecting quotes. */
    let j = lt + m[0].length, q = '';
    while (j < n) {
      const ch = html.charAt(j);
      if (q) { if (ch === q) q = ''; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '>') break;
      j++;
    }
    const end = Math.min(n, j + 1);
    const raw = html.slice(lt, end);
    const selfClosed = /\/\s*>$/.test(raw);

    if (!closing && OPAQUE.has(name) && !selfClosed) {
      /* Copy through to the matching close tag (opaque elements do not nest
         in practice: a <svg> inside a <svg> is the exception and a harmless
         one — the inner close ends the run early and the rest is text we
         skip anyway because it carries no letters … or does not; so look
         for the LAST close of a run of the same name only for svg). */
      const closeRe = new RegExp('</' + name + '\\s*>', 'ig');
      closeRe.lastIndex = end;
      let cm, depth = 1, k = end;
      if (name === 'svg') {
        /* nested <svg> happens in icon sprites */
        const openRe = /<svg[\s>]/ig; openRe.lastIndex = end;
        while (depth > 0) {
          const c = closeRe.exec(html); if (!c) { k = n; break; }
          openRe.lastIndex = k;
          let o; let opens = 0;
          while ((o = openRe.exec(html)) && o.index < c.index) opens++;
          depth += opens - 1; k = c.index + c[0].length; closeRe.lastIndex = k;
        }
      } else {
        cm = closeRe.exec(html); k = cm ? cm.index + cm[0].length : n;
      }
      const whole = html.slice(lt, k);
      if (name === 'svg' || name === 'noscript') {
        /* An icon inside a label is part of the label. */
        seg.push({ t: 'tag', kind: 'void', raw: whole, pos: lt, name });
      } else {
        flush();
      }
      /* Attributes on the opening tag still count (an <svg> with a title
         attribute, a textarea with a placeholder). */
      if (!inNo()) readAttrs(raw, lt, name, attrs);
      i = k; continue;
    }

    if (INLINE.has(name)) {
      /* An inline element marked translate="no" — a university's name in a
         line of words — is one opaque placeholder: its words are not in
         the key, and they are put back as they are. */
      if (!closing && !VOID.has(name) && !selfClosed && /\stranslate=["']?no["']?/i.test(raw)) {
        const closeRe = new RegExp('</' + name + '\\s*>', 'ig'); closeRe.lastIndex = end;
        const openRe = new RegExp('<' + name + '[\\s>]', 'ig');
        let depth = 1, k = end;
        while (depth > 0) {
          const c = closeRe.exec(html); if (!c) { k = n; break; }
          openRe.lastIndex = k; let o, opens = 0;
          while ((o = openRe.exec(html)) && o.index < c.index) opens++;
          depth += opens - 1; k = c.index + c[0].length; closeRe.lastIndex = k;
        }
        seg.push({ t: 'tag', kind: 'void', raw: html.slice(lt, k), pos: lt, name });
        i = k; continue;
      }
      if (closing) seg.push({ t: 'tag', kind: 'close', raw, pos: lt, name });
      else if (VOID.has(name) || selfClosed) seg.push({ t: 'tag', kind: 'void', raw, pos: lt, name });
      else seg.push({ t: 'tag', kind: 'open', raw, pos: lt, name });
      if (!closing && !inNo()) readAttrs(raw, lt, name, attrs);
      /* An inline element marked translate="no" (a name in a sentence):
         the sentence is left whole — rare, and the translator is told to
         keep names anyway. */
      i = end; continue;
    }

    /* A block boundary. */
    flush();
    if (closing) {
      let k = stack.length - 1;
      while (k >= 0 && stack[k][0] !== name) k--;
      if (k >= 0) { const popped = stack.splice(k); popped.forEach(p => { if (p[1]) noDepth--; }); }
    } else {
      const a = attrsOf(raw);
      const no = (attrValue(a, 'translate') || '').toLowerCase() === 'no';
      if (!VOID.has(name) && !selfClosed) { stack.push([name, no]); if (no) noDepth++; }
      if (!inNo() && !no) readAttrsParsed(a, raw, lt, name, attrs);
    }
    i = end;
  }
  flush();
  return { units, attrs };
}

function readAttrs(raw, pos, name, out) { readAttrsParsed(attrsOf(raw), raw, pos, name, out); }
function readAttrsParsed(a, raw, pos, name, out) {
  for (const at of a) {
    let want = TEXT_ATTRS.includes(at.name);
    if (name === 'meta' && at.name === 'content') {
      const key = (attrValue(a, 'name') || attrValue(a, 'property') || '').toLowerCase();
      want = META_NAMES.has(key);
    }
    if (name === 'input' && at.name === 'value') {
      const type = (attrValue(a, 'type') || '').toLowerCase();
      want = type === 'submit' || type === 'button' || type === 'reset';
    }
    if (!want || !at.value.trim()) continue;
    if ((at.name === 'title' || at.name === 'alt') && name === 'img' && /^(glovels|logo)$/i.test(at.value.trim())) continue;
    const nums = [];
    const key = numbered(spaces(at.value), nums).trim();
    if (key.length > MAX_UNIT || notWords(key)) continue;
    out.push({ key, hash: hash(key), start: pos + at.start, end: pos + at.end, tags: [], nums, attr: at.name, parent: name, q: at.q });
  }
}

/*
 * Put a translation back: the placeholders become the tags and numbers of
 * THIS occurrence. Returns null when the translation does not carry every
 * placeholder exactly once (it is then not used, and the unit is flagged by
 * the translator the next time round).
 */
function rebuild(text, unit) {
  const seen = {};
  let bad = false;
  const out = String(text).replace(/<(\/?)(\d+)(\/?)>|\{(\d+)\}/g, (m, cl, tn, sc, nn) => {
    if (nn != null) {
      const v = unit.nums[Number(nn) - 1];
      if (v == null) { bad = true; return m; }
      seen['n' + nn] = (seen['n' + nn] || 0) + 1;
      return v;
    }
    const t = unit.tags[Number(tn) - 1];
    if (t == null) { bad = true; return m; }
    const k = (cl ? 'c' : sc ? 'v' : 'o') + tn;
    seen[k] = (seen[k] || 0) + 1;
    if (Array.isArray(t)) return cl ? t[1] : sc ? (bad = true, m) : t[0];
    return (cl || !sc) ? (bad = true, m) : t;
  });
  if (bad) return null;
  /* Every placeholder of the source exactly once; and no stray markup. */
  for (const m of unit.key.matchAll(/<(\/?)(\d+)(\/?)>|\{(\d+)\}/g)) {
    const k = m[4] != null ? 'n' + m[4] : (m[1] ? 'c' : m[3] ? 'v' : 'o') + m[2];
    if (seen[k] !== 1) return null;
  }
  /* Nothing that looks like markup of the translation's own. */
  let rest = out;
  for (const t of unit.tags) {
    if (Array.isArray(t)) { rest = rest.split(t[0]).join('').split(t[1]).join(''); }
    else rest = rest.split(t).join('');
  }
  if (/<\s*\/?\s*[a-zA-Z!]/.test(rest)) return null;
  return out;
}

/* Does a translated string still carry exactly the source's placeholders and
   nothing that looks like markup of its own? The translator asks this before
   a line is stored; rebuild() asks it again on the way out. */
function placeholdersMatch(key, text) {
  const count = s => { const c = {}; for (const m of String(s).matchAll(/<(\/?)(\d+)(\/?)>|\{(\d+)\}/g)) { const k = m[4] != null ? 'n' + m[4] : (m[1] ? 'c' : m[3] ? 'v' : 'o') + m[2]; c[k] = (c[k] || 0) + 1; } return c; };
  const a = count(key), b = count(text);
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  const rest = String(text).replace(/<(\/?)(\d+)(\/?)>|\{(\d+)\}/g, '');
  if (/<\s*\/?\s*[a-zA-Z!]/.test(rest)) return false;
  return true;
}

/* The page family a request belongs to, for the dictionary scripts read:
   "home", "study-in-germany", "university/*", "post/*", "dashboard". */
function pageKeyOf(pathname) {
  const p = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (p === '/') return 'home';
  const segs = p.slice(1).split('/');
  if (segs.length === 1) return segs[0];
  if (segs[0] === 'university') return segs.length > 2 ? 'university/*/*' : 'university/*';
  return segs[0] + '/*';
}
/* Page families where most of a page is one university's or one post's own
   data: a unit is only worth translating once it has been seen on two
   different pages of the family (so the template's words are translated and
   one page's data is not). */
const DATA_FAMILIES = new Set(['university/*', 'university/*/*', 'post/*', 'acceptance/*']);

/* Addresses that never take a language prefix. */
const STAFF = /^\/(admin|counsellor|chat|home|catalogue|blog-admin|leads|leads-command|ops|marketing|partner|languages|404)(\.html)?(\/|$)/;
const NO_PREFIX = /^\/(api|js|images|logos|flags|assets|data|server|og|post\/_|\.well-known)(\/|$)|^\/[^?#]*\.(xml|txt|json|ico|png|jpg|jpeg|webp|svg|gif|js|css|webmanifest|php|pdf)(\?|#|$)|^\/(sitemap|robots|llms)/i;
function prefixable(href) {
  if (!href || href.charAt(0) !== '/' || href.startsWith('//')) return false;
  if (PREFIX_RE.test(href)) return false;
  if (NO_PREFIX.test(href) || STAFF.test(href)) return false;
  return true;
}
/* The home page of a language is /zh/ with the slash, so the relative
   links the written pages carry ("study-in-germany.html", "login.html")
   resolve under the prefix. */
function prefixHref(lang, href) {
  if (lang === 'en' || !prefixable(href)) return href;
  if (href === '/') return '/' + lang + '/';
  if (href.charAt(1) === '#' || href.charAt(1) === '?') return '/' + lang + '/' + href.slice(1);
  return '/' + lang + href;
}

/* Rewrite the links of a page so a reader stays in their language. Only the
   href of <a> and <area>, and the action of forms that go to a page. */
function prefixLinks(html, lang) {
  if (lang === 'en') return html;
  return html.replace(/<(a|area|form)\b([^>]*?)\s(href|action)=("([^"]*)"|'([^']*)')/gi, (m, tag, pre, an, q, v1, v2) => {
    const v = v1 != null ? v1 : v2;
    if (tag.toLowerCase() === 'form' && (v.startsWith('/api') || v.endsWith('.php'))) return m;
    const nv = prefixHref(lang, v);
    if (nv === v) return m;
    return '<' + tag + pre + ' ' + an + '=' + q.charAt(0) + nv + q.charAt(0);
  });
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* The hreflang links for a public page: one per language and x-default. */
function alternates(siteUrl, pathname, langs) {
  if (!siteUrl) return '';
  const p = pathname === '/' ? '' : pathname;
  const lines = ['<link rel="alternate" hreflang="x-default" href="' + esc(siteUrl + (p || '/')) + '">',
    '<link rel="alternate" hreflang="en" href="' + esc(siteUrl + (p || '/')) + '">'];
  for (const c of langs) {
    if (c === 'en') continue;
    lines.push('<link rel="alternate" hreflang="' + (BY_CODE[c].hreflang || c) + '" href="' + esc(siteUrl + '/' + c + (p || '/')) + '">');
  }
  return lines.join('\n') + '\n';
}

/* A few rules for scripts that are not ours and fonts that have no glyphs
   for the script: the display face is Latin-only, so headings in Chinese,
   Arabic or Bengali fall back to the system's own face cleanly. */
function langCss(lang) {
  const l = BY_CODE[lang];
  if (!l || lang === 'en') return '';
  let css = '';
  if (['zh', 'ar', 'bn', 'ru'].includes(lang)) {
    css += 'html[lang="' + lang + '"] body,html[lang="' + lang + '"] h1,html[lang="' + lang + '"] h2,html[lang="' + lang + '"] h3,html[lang="' + lang + '"] h4,html[lang="' + lang + '"] button,html[lang="' + lang + '"] input,html[lang="' + lang + '"] select{font-family:system-ui,-apple-system,"Segoe UI","Noto Sans","Noto Sans ' + ({ zh: 'SC', ar: 'Arabic', bn: 'Bengali', ru: '' })[lang] + '",Roboto,Helvetica,Arial,sans-serif}'
      + 'html[lang="' + lang + '"] h1,html[lang="' + lang + '"] h2{letter-spacing:0}';
  }
  if (l.dir === 'rtl') {
    /* Right to left. The pages' own CSS is written left to right; the
       browser mirrors the flex and grid layouts on its own, and these rules
       catch what it does not: an off-screen honeypot at left:-9999px, which
       in a right-to-left page becomes nine thousand pixels of sideways
       scroll, and the picker's pop-up anchored to the wrong edge. */
    css += 'html[dir="rtl"] body{direction:rtl}html[dir="rtl"],html[dir="rtl"] body{overflow-x:clip}'
      + 'html[dir="rtl"] .offscreen,html[dir="rtl"] .sr-only,html[dir="rtl"] .visually-hidden,html[dir="rtl"] .nm-hp,html[dir="rtl"] [style*="left:-9999px"]{left:auto!important;right:-9999px!important}'
      + 'html[dir="rtl"] .glv-loc-pop{right:auto;left:0}html[dir="rtl"] input[type="search"],html[dir="rtl"] input[type="email"],html[dir="rtl"] input[type="tel"],html[dir="rtl"] input[type="url"],html[dir="rtl"] input[type="number"]{direction:ltr;text-align:right}';
  }
  return css ? '<style id="glvLangCss">' + css + '</style>\n' : '';
}

/*
 * translatePage(html, lang, opts) → { html, missing, seen }
 *
 *   lookup(hash)   → the translated text, or null
 *   missing        → [{key, hash, attr}] units with no translation yet
 *   seen           → every unit hash on the page (for the page's dictionary)
 */
function translatePage(html, lang, opts) {
  const o = opts || {};
  const lookup = o.lookup || (() => null);
  /* Strings the caller already translated (a post's title in <title>):
     neither rewritten nor reported. */
  const skip = new Set((o.skip || []).map(x => keyOf(x).hash));
  const { units, attrs } = segment(html);
  const all = units.concat(attrs).sort((a, b) => a.start - b.start);
  const missing = [], seenSet = new Set();
  const edits = [];
  for (const u of all) {
    if (skip.has(u.hash)) continue;
    if (seenSet.has(u.hash)) { /* same unit twice on the page: still rewrite each */ } else seenSet.add(u.hash);
    const t = lookup(u.hash);
    if (t == null) { if (!missing.some(m => m.hash === u.hash)) missing.push({ key: u.key, hash: u.hash, attr: u.attr || '' }); continue; }
    const r = rebuild(t, u);
    if (r == null) continue;
    /* Marked, so the script in the browser (assets/i18n-client.js) knows
       this text was translated here and does not report it as a new line:
       a comment before the words, or the mark the script itself uses on an
       attribute. Not in <title> (a comment there would be read as text)
       and not on <meta>, which the script never looks at. */
    if (u.attr) {
      /* Escaped for the quote the attribute uses, and never a < or > — a
         translation is words, and rebuild() has already refused markup. */
      const v = r.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const mark = u.parent === 'meta' ? '' : ' data-glv-' + u.attr + '="' + v + '"';
      edits.push([u.start, u.end, v, mark]);
    } else {
      edits.push([u.start, u.end, (u.parent === 'title' || u.parent === 'textarea' ? '' : '<!--t-->') + r]);
    }
  }
  let out = html;
  for (let k = edits.length - 1; k >= 0; k--) {
    const [s, e, r, mark] = edits[k];
    /* an attribute: the mark goes after the closing quote */
    out = mark ? out.slice(0, s) + r + out.slice(e, e + 1) + mark + out.slice(e + 1) : out.slice(0, s) + r + out.slice(e);
  }
  return { html: out, missing, seen: [...seenSet] };
}

/* The page's head and chrome for a language: <html lang dir>, the hreflang
   links, the canonical and og:url under the prefix, the links of the page,
   the dictionary for the scripts and the script that applies it. */
function finishPage(html, lang, o) {
  const l = BY_CODE[lang] || BY_CODE.en;
  const pathname = o.pathname || '/';
  let out = html;
  if (lang !== 'en') {
    out = out.replace(/<html\b([^>]*)>/i, (m, a) => {
      let at = a.replace(/\slang=("[^"]*"|'[^']*')/i, '').replace(/\sdir=("[^"]*"|'[^']*')/i, '');
      return '<html' + at + ' lang="' + lang + '"' + (l.dir === 'rtl' ? ' dir="rtl"' : '') + '>';
    });
    if (o.siteUrl) {
      const site = o.siteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('(<link rel="canonical" href="' + site + ')(/[^"]*)?(")', 'i'), (m, a, p, b) => a + '/' + lang + (p && p !== '/' ? p : '/') + b);
      out = out.replace(new RegExp('(<meta property="og:url" content="' + site + ')(/[^"]*)?(")', 'i'), (m, a, p, b) => a + '/' + lang + (p && p !== '/' ? p : '/') + b);
    }
    out = prefixLinks(out, lang);
  }
  const headEnd = out.indexOf('</head>');
  if (headEnd >= 0) {
    let add = '';
    if (o.indexable && o.siteUrl && !/hreflang=/i.test(out.slice(0, headEnd))) add += alternates(o.siteUrl, pathname, o.langs || CODES);
    if (lang !== 'en') {
      add += langCss(lang);
      add += '<script id="glvI18n" type="application/json">' + JSON.stringify({ lang, dir: l.dir, page: o.pageKey || '', d: o.dict || {} }).replace(/</g, '\\u003c') + '</script>\n'
        + '<script src="/js/i18n.js" defer></script>\n';
    }
    if (add) out = out.slice(0, headEnd) + add + out.slice(headEnd);
  }
  return out;
}

/* Plain text (the text part of an email): each paragraph is a unit. */
function translateText(text, lookup, missing) {
  return String(text).split(/\n{2,}/).map(par => {
    const nums = [];
    const key = numbered(spaces(par.trim()), nums).trim();
    if (!key || notWords(key)) return par;
    const h = hash(key);
    const t = lookup(h);
    if (t == null) { if (missing && !missing.some(m => m.hash === h)) missing.push({ key, hash: h, attr: 'text' }); return par; }
    const r = rebuild(t, { key, tags: [], nums });
    return r == null ? par : r;
  }).join('\n\n');
}

/* A single string (a subject line, a label from a script). */
function keyOf(s) {
  const nums = [];
  const key = numbered(spaces(String(s == null ? '' : s)), nums).trim();
  return { key, hash: hash(key), nums, tags: [] };
}
function translateString(s, lookup, missing) {
  const u = keyOf(s);
  if (!u.key || notWords(u.key)) return s;
  const t = lookup(u.hash);
  if (t == null) { if (missing && !missing.some(m => m.hash === u.hash)) missing.push({ key: u.key, hash: u.hash, attr: 'text' }); return s; }
  const r = rebuild(t, u);
  return r == null ? s : r;
}

module.exports = { LANGS, BY_CODE, CODES, OTHER, PREFIX_RE, STAFF, hash, segment, rebuild, placeholdersMatch,
  translatePage, finishPage, translateText, translateString, keyOf, pageKeyOf, DATA_FAMILIES, prefixHref, prefixLinks, alternates, notWords };
