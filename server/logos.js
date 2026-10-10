'use strict';
/*
 * University logos.
 *
 * logos/ holds one file per German university, pulled from the DAAD index,
 * and assets/logos.json says which file is whose:
 *
 *   { "files":   { "<University name>": "<file>", … },
 *     "aliases": { "<file>": ["<short name>", …], … } }
 *
 * The catalogue spells a university's name its own way — "EBS University of
 * Business and Law" where the index says "EBS Universität für Wirtschaft und
 * Recht", "TU Dortmund University" for "Technische Universität Dortmund",
 * umlauts written as ue/oe/ae or not at all — so a name is looked up in
 * four steps, each looser than the last:
 *
 *   1. the exact name, as written;
 *   2. an alias, as written;
 *   3. the NORMALISED name: accents off, lower case, punctuation gone, the
 *      words every name shares (university, of, applied, sciences,
 *      hochschule, für, …) dropped, ß→ss and ü/ue→u so the German and
 *      English spellings collapse to the same thing;
 *   4. the tokens of that normalised name against every entry's, taking the
 *      one with the highest Jaccard overlap if it is at least 0.6 and no
 *      other entry ties it.
 *
 * Every answer is cached per (name, shortName). The file is re-read when
 * its mtime changes, so a logo added on the server is seen without a
 * restart. Nothing here reads logos/ itself: the index is the truth, and a
 * name that is not in it has no logo, which is honest.
 *
 * The browser has a simplified copy of steps 1–4 in find.js and fitpanel.js
 * (window.FIND_LOGOS / /logos/index.json). Change the normalisation here and
 * change it there.
 */
const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'assets', 'logos.json');
const DIR = path.join(__dirname, '..', 'logos');
const URL_BASE = '/logos/';

/* Words that say nothing about WHICH university this is. */
const STOP = new Set(['university', 'universitat', 'univ', 'uni', 'of', 'the', 'and', 'for', 'in', 'at',
  'applied', 'sciences', 'science', 'arts', 'hochschule', 'fachhochschule', 'fh', 'hs', 'uas', 'fur', 'und', 'der', 'die', 'des',
  'college', 'school', 'campus', 'gmbh', 'ag', 'ev', 'e', 'v']);
/* "Technische Universität", "Technical University", "TU", "TH": the one word
   that tells TU München from Hochschule München, kept as one token. */
const TECH = new Set(['technische', 'technology', 'technical', 'tu', 'th']);
/* The English name of a city beside the German one in the index. */
const CITY = { munich: 'munchen', nuremberg: 'nurnberg', cologne: 'koln', hanover: 'hannover', brunswick: 'braunschweig',
  berliner: 'berlin', frankfurter: 'frankfurt', hamburger: 'hamburg' };

/** One spelling for the same name, however it was typed. */
function normalise(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ');
  /* ue/oe/ae are how umlauts are typed without the keys — fold them the same
     way, so Muenchen and München both read munchen. (After the accents are
     off, so "Universität" does not become "Universitat"→"Universitt".) */
  s = s.replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a');
  return s.split(' ').map(w => TECH.has(w) ? 'tech' : (CITY[w] || w)).filter(w => w && !STOP.has(w));
}
const key = toks => toks.join(' ');

let loaded = null;   /* { mtime, files, aliases, exact: Map, norm: Map, entries: [{file, toks:Set}], cache: Map } */

function load() {
  let st = null;
  try { st = fs.statSync(INDEX); } catch (e) { st = null; }
  const mtime = st ? st.mtimeMs : 0;
  if (loaded && loaded.mtime === mtime) return loaded;
  let raw = { files: {}, aliases: {} };
  if (st) { try { raw = JSON.parse(fs.readFileSync(INDEX, 'utf8')) || raw; } catch (e) { raw = { files: {}, aliases: {} }; } }
  const files = raw.files && typeof raw.files === 'object' ? raw.files : {};
  const aliases = raw.aliases && typeof raw.aliases === 'object' ? raw.aliases : {};
  const exact = new Map(), norm = new Map(), entries = [];
  const put = (name, file) => {
    const f = String(file || '');
    if (!f || !/^[^/\\]+\.(?:png|jpe?g|svg|webp|gif)$/i.test(f)) return;
    if (!exact.has(name)) exact.set(name, f);
    const toks = normalise(name);
    if (!toks.length) return;
    const k = key(toks);
    if (!norm.has(k)) norm.set(k, f);
    entries.push({ file: f, toks: new Set(toks) });
  };
  Object.keys(files).forEach(n => put(n, files[n]));
  Object.keys(aliases).forEach(f => (Array.isArray(aliases[f]) ? aliases[f] : []).forEach(a => put(a, f)));
  loaded = { mtime, files, aliases, exact, norm, entries, cache: new Map() };
  return loaded;
}

function jaccard(a, b) {
  let both = 0;
  a.forEach(t => { if (b.has(t)) both++; });
  const all = a.size + b.size - both;
  return all ? both / all : 0;
}

/** The file for one spelling, or ''. */
function fileFor(L, name) {
  const n = String(name || '').trim();
  if (!n) return '';
  if (L.exact.has(n)) return L.exact.get(n);
  const toks = normalise(n);
  if (!toks.length) return '';
  const k = key(toks);
  if (L.norm.has(k)) return L.norm.get(k);
  const set = new Set(toks);
  let best = null, bestScore = 0, tie = false;
  for (const e of L.entries) {
    const s = jaccard(set, e.toks);
    if (s > bestScore) { best = e; bestScore = s; tie = false; }
    else if (s === bestScore && best && e.file !== best.file) tie = true;
  }
  return best && bestScore >= 0.6 && !tie ? best.file : '';
}

/** '/logos/<file>' for a university, or '' when none is known. */
function logoFor(name, shortName) {
  const L = load();
  const ck = String(name || '') + '\u0000' + String(shortName || '');
  if (L.cache.has(ck)) return L.cache.get(ck);
  /* "BHT Berlin (Berliner Hochschule für Technik)": the whole, then the
     name outside the brackets, then the one inside, then the short name. */
  const n = String(name || '');
  const paren = /^([^()]+)\(([^()]+)\)\s*$/.exec(n);
  const f = fileFor(L, n)
    || (paren ? fileFor(L, paren[1]) || fileFor(L, paren[2]) : '')
    || fileFor(L, shortName);
  const out = f ? URL_BASE + encodeURIComponent(f) : '';
  L.cache.set(ck, out);
  return out;
}

/** The index as the browser gets it (/logos/index.json). */
function index() { const L = load(); return { files: L.files, aliases: L.aliases }; }

/**
 * The file on disk for a name the index uses, or null. Only names the index
 * holds are served — /logos/ is not a directory listing — and the name is a
 * bare file name, so ../ never reaches past logos/. One wrinkle: a name
 * with an accent ("Charité_…") was unpacked as "Charit#U00e9_…", so that
 * spelling is tried when the plain one is not there.
 */
function pathFor(file) {
  const L = load();
  const f = String(file || '');
  if (!f || f.includes('/') || f.includes('\\') || f.includes('..')) return null;
  const named = L.entries.some(e => e.file === f) || Object.keys(L.files).some(n => L.files[n] === f);
  if (!named) return null;
  const plain = path.join(DIR, f);
  if (fs.existsSync(plain)) return plain;
  const mangled = path.join(DIR, f.replace(/[^\x20-\x7e]/g, ch => '#U' + ch.charCodeAt(0).toString(16).padStart(4, '0')));
  return fs.existsSync(mangled) ? mangled : null;
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' };
const mimeOf = file => MIME[path.extname(String(file || '')).toLowerCase()] || 'application/octet-stream';

/**
 * How many of these universities have a logo. `universities` is a list of
 * names, or of objects with name/university and shortName.
 */
function coverage(universities) {
  const matched = [], unmatched = [];
  const seen = new Set();
  (universities || []).forEach(u => {
    const name = typeof u === 'string' ? u : (u && (u.name || u.university)) || '';
    const short = typeof u === 'string' ? '' : (u && u.shortName) || '';
    if (!name || seen.has(name)) return;
    seen.add(name);
    (logoFor(name, short) ? matched : unmatched).push(name);
  });
  return { total: matched.length + unmatched.length, matched: matched.length, matchedNames: matched, unmatched };
}

module.exports = { logoFor, coverage, normalise, index, pathFor, mimeOf, URL_BASE };
