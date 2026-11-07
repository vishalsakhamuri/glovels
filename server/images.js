'use strict';
/*
 * Pictures for the blog, kept on the data disk and served at /images/<name>.
 *
 * The editor could print a picture from the day it existed — `![alt](url)` —
 * and nobody in the office could use it, because the url had to be one that
 * already existed somewhere on the internet. Every post on glovels.com has a
 * hero picture and most have two or three in the body; the new blog had none,
 * not because the renderer could not draw them but because there was no way
 * to get a file from a laptop onto the server. This is that way.
 *
 * Why the data disk and not the repository: a picture uploaded from the admin
 * screen has to survive a deploy, and the container's own filesystem does not.
 * Same reason a passport scan lives in DATA_DIR/uploads. Same disk, its own
 * directory, because uploads/ is private by rule and this directory is public
 * by rule, and one directory cannot be both.
 *
 * Why names are minted here and never taken from the upload: a filename is
 * chosen by whoever sent it. `../../glovels.db` is a filename. So is
 * `IMG_4021 (1).JPG`, which is harmless and looks terrible in an address bar.
 * The stored name is the original's stem, slugified, plus a timestamp so two
 * uploads of `banner.png` a week apart are two files — and because the name
 * changes when the file does, the browser may cache it for a year.
 */

const fs = require('fs');
const path = require('path');

const MAX_MB = 8;

/* The four kinds a web page can show and every browser draws. SVG is
   deliberately absent: an SVG is a document that can carry a script, and an
   upload route that stores one and serves it back from our own origin is a
   stored XSS with a picture in it. */
const KINDS = [
  { ext: 'jpg', mime: 'image/jpeg', names: ['jpg', 'jpeg'],
    sig: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', names: ['png'],
    sig: b => b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { ext: 'gif', mime: 'image/gif', names: ['gif'],
    sig: b => /^GIF8[79]a$/.test(b.slice(0, 6).toString('latin1')) },
  { ext: 'webp', mime: 'image/webp', names: ['webp'],
    sig: b => b.slice(0, 4).toString('latin1') === 'RIFF'
      && b.slice(8, 12).toString('latin1') === 'WEBP' },
];
const ACCEPTS = 'JPG, PNG, GIF or WebP';

/** The kind a buffer IS, from its bytes — the name is not consulted. */
function kindOf(buf) {
  if (!buf || buf.length < 12) return null;
  return KINDS.find(k => k.sig(buf)) || null;
}

/** null when the file is one we take, or the sentence saying why not. */
function refuse(name, buf) {
  if (!buf || !buf.length) return 'No file arrived. Try again.';
  if (buf.length > MAX_MB * 1024 * 1024) {
    return 'That picture is ' + (buf.length / 1048576).toFixed(1) + ' MB, and ' + MAX_MB
      + ' MB is the limit. Export it smaller — 1600 pixels wide is plenty for a post.';
  }
  const kind = kindOf(buf);
  if (!kind) {
    return 'Glovels takes ' + ACCEPTS + '. "' + String(name || 'That file').slice(0, 60)
      + '" is not one of those inside, whatever it is called.';
  }
  return null;
}

/* The stem of the original name, made safe. `Photo of TUM (1).JPG` becomes
   `photo-of-tum-1`; a name that is nothing but punctuation becomes `picture`. */
const stem = name => String(name || '').replace(/\.[^.]*$/, '')
  .toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'picture';

/** A name that does not exist in `dir` yet, ending in the extension the bytes
    say it should. */
function mintName(dir, original, kind, hint) {
  const base = (hint ? String(hint).replace(/[^a-z0-9-]/g, '') + '-' : '') + stem(original);
  let name = base + '-' + Date.now().toString(36) + '.' + kind.ext;
  let n = 2;
  while (fs.existsSync(path.join(dir, name))) {
    name = base + '-' + Date.now().toString(36) + '-' + n++ + '.' + kind.ext;
  }
  return name;
}

/** Store a picture. Returns { name, url, bytes, mime } or { error }. */
function store(dir, original, buf, hint) {
  const why = refuse(original, buf);
  if (why) return { error: why };
  fs.mkdirSync(dir, { recursive: true });
  const kind = kindOf(buf);
  const name = mintName(dir, original, kind, hint);
  fs.writeFileSync(path.join(dir, name), buf);
  return { name, url: '/images/' + name, bytes: buf.length, mime: kind.mime };
}

/* Only a name this module could have minted is ever read back. A request for
   `/images/../glovels.db` never reaches the filesystem. */
const SAFE = /^[a-z0-9][a-z0-9-]{0,120}\.(?:jpg|png|gif|webp)$/;

/** The file for a public name, or null. */
function fileFor(dir, name) {
  if (!SAFE.test(String(name || ''))) return null;
  const p = path.join(dir, name);
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return null;
    const kind = KINDS.find(k => k.ext === path.extname(name).slice(1));
    return { path: p, mime: kind ? kind.mime : 'application/octet-stream', bytes: st.size,
      mtime: st.mtimeMs };
  } catch (e) { return null; }
}

/*
 * Patch 283 (team checklist, item 11 — "critical"): the blog served original
 * pictures, two of about 2 MB each on one post. There is no image library on
 * the server (no dependencies, 512 MB), so the office's browser does the work,
 * as patch 276 does for students' photos: it draws each picture smaller and
 * sends back WebP copies 480, 960 and 1600 pixels wide and a 1200×630 JPEG for
 * link previews. The original is never touched; the pages offer the copies
 * through <picture>/srcset, so a phone downloads the 480 one.
 *
 *   photo-abc.jpg  →  photo-abc--v480.webp, --v960.webp, --v1600.webp, --og.jpg
 */
const VARIANTS = { v480: 'webp', v960: 'webp', v1600: 'webp', og: 'jpg' };
const VARIANT_RE = /--(?:v480|v960|v1600|og)\.(?:webp|jpg)$/;
const variantName = (name, v) => String(name).replace(/\.[a-z]+$/, '') + '--' + v + '.' + VARIANTS[v];
const isVariant = n => VARIANT_RE.test(String(n || ''));

function dimsFile(dir) { return path.join(dir, '_dims.json'); }
let dimsCache = null, dimsAt = 0;
function dims(dir) {
  try {
    const st = fs.statSync(dimsFile(dir));
    if (!dimsCache || st.mtimeMs !== dimsAt) { dimsCache = JSON.parse(fs.readFileSync(dimsFile(dir), 'utf8')) || {}; dimsAt = st.mtimeMs; }
    return dimsCache;
  } catch (e) { return {}; }
}

/** Store one copy of an existing picture. Refuses anything that is not the
    right kind, is bigger than it should be, or belongs to no picture. */
function storeVariant(dir, name, v, buf) {
  if (!SAFE.test(String(name || '')) || isVariant(name)) return { error: 'No such picture.' };
  if (!VARIANTS[v]) return { error: 'Unknown size.' };
  if (!fs.existsSync(path.join(dir, name))) return { error: 'No such picture.' };
  const kind = kindOf(buf);
  if (!kind || kind.ext !== VARIANTS[v]) return { error: 'That copy is not a ' + VARIANTS[v].toUpperCase() + '.' };
  if (buf.length > 900 * 1024) return { error: 'That copy is too big.' };
  const out = variantName(name, v);
  fs.writeFileSync(path.join(dir, out), buf);
  return { name: out, url: '/images/' + out, bytes: buf.length };
}
function setDims(dir, name, w, h) {
  w = Math.round(Number(w)); h = Math.round(Number(h));
  if (!(w > 0 && h > 0 && w < 20000 && h < 20000)) return;
  const d = Object.assign({}, dims(dir));
  d[name] = [w, h];
  fs.writeFileSync(dimsFile(dir), JSON.stringify(d));
}
/** What a page needs to offer the copies: which exist, and the size. */
function variantsOf(dir, name) {
  if (!SAFE.test(String(name || '')) || isVariant(name)) return null;
  const has = {};
  Object.keys(VARIANTS).forEach(v => { if (fs.existsSync(path.join(dir, variantName(name, v)))) has[v] = '/images/' + variantName(name, v); });
  const d = dims(dir)[name] || null;
  return { has, w: d ? d[0] : 0, h: d ? d[1] : 0 };
}

/** Everything in the directory, newest first. The copies are not listed as
    pictures of their own; each picture says whether it has them. */
function list(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  const all = new Set(names);
  return names.filter(n => SAFE.test(n) && !isVariant(n)).map(n => {
    const f = fileFor(dir, n);
    return f && { name: n, url: '/images/' + n, bytes: f.bytes, mime: f.mime, at: f.mtime,
      optimised: all.has(variantName(n, 'v960')) && all.has(variantName(n, 'og')) };
  }).filter(Boolean).sort((a, b) => b.at - a.at);
}

module.exports = { MAX_MB, ACCEPTS, kindOf, refuse, store, fileFor, list, SAFE,
  VARIANTS, variantName, isVariant, storeVariant, setDims, variantsOf, dims };
