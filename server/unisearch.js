'use strict';
/*
 * Which universities a search box names (round 169, WEB-06).
 *
 * "TU Munich" found three private HDBW programmes and none of TUM's 61;
 * "Bremen" found the one private university there and none of the public
 * ones. A locked public row carries no name and no city, so the browser had
 * nothing to match the words against — the search has to happen here, where
 * the names are.
 *
 * A university answers a search when EVERY word typed (normalised the way the
 * logo matcher normalises a name: umlauts folded, "TU"/"Technische"/
 * "Technical" one token, Munich = München, words like "University" and
 * "Hochschule" dropped) is one of its words — taken from its name, its short
 * name, its city, and every alias the logo index files under the same logo.
 * So "TU Munich", "TU München", "Technische Universität München" and "TUM"
 * all land on TUM; "Bremen" lands on every university in Bremen.
 *
 * The answer is a set of university keys. The finder shows the rows behind
 * them as it shows any row — a locked one stays locked.
 */
const LOGOS = require('./logos.js');

let memo = { rows: null, list: null };

/* What people call a university by its initials — TUM for Technical
   University of Munich, KIT for Karlsruhe Institute of Technology, LMU for
   Ludwig-Maximilians-Universität München (the city dropped). Three letters
   or more, so "UB" does not land on every University of B…. */
const SMALL = new Set(['of', 'the', 'and', 'for', 'in', 'at', 'de', 'der', 'die', 'des', 'fur', 'für', 'und', 'am', 'an', 'zu']);
function acronyms(name) {
  const words = String(name || '').replace(/\([^)]*\)/g, ' ').split(/[\s\-–\/,&]+/)
    .map(w => w.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, ''))
    .filter(w => w && !SMALL.has(w.toLowerCase()));
  const out = [];
  if (words.length >= 3) {
    out.push(words.map(w => w[0]).join('').toLowerCase());
    out.push(words.slice(0, -1).map(w => w[0]).join('').toLowerCase());
  }
  /* A name that already is an acronym — "RWTH Aachen" — keeps it whole. */
  words.forEach(w => { if (w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) out.push(w.toLowerCase()); });
  return out.filter(a => a.length >= 3);
}

/* One entry per university: its key and every token anything calls it. */
function universities(rows) {
  if (memo.rows === rows && memo.list) return memo.list;
  const L = LOGOS.index();
  const files = L.files || {}, aliases = L.aliases || {};
  /* file -> every name that points at it */
  const namesOf = {};
  Object.keys(files).forEach(n => { (namesOf[files[n]] = namesOf[files[n]] || []).push(n); });
  Object.keys(aliases).forEach(f => (aliases[f] || []).forEach(a => { (namesOf[f] = namesOf[f] || []).push(a); }));
  const by = new Map();
  (rows || []).forEach(p => {
    if (!p || !p.uKey) return;
    let u = by.get(p.uKey);
    if (!u) {
      u = { key: String(p.uKey), toks: new Set(), whole: new Set() };
      by.set(p.uKey, u);
      const logo = LOGOS.logoFor(p.university, p.shortName);
      const file = logo ? decodeURIComponent(logo.slice(LOGOS.URL_BASE.length)) : '';
      [p.university, p.shortName].concat(file ? namesOf[file] || [] : []).forEach(n => {
        LOGOS.normalise(n).forEach(t => u.toks.add(t));
        acronyms(n).forEach(a => u.toks.add(a));
      });
    }
    if (p.city) LOGOS.normalise(p.city).forEach(t => u.toks.add(t));
  });
  memo = { rows, list: [...by.values()] };
  return memo.list;
}

/** The keys (uKey) of the universities `q` names; empty when it names none. */
function match(rows, q) {
  const want = LOGOS.normalise(String(q || '').slice(0, 80));
  if (!want.length) return [];
  return universities(rows).filter(u => want.every(t => u.toks.has(t))).map(u => u.key);
}

module.exports = { match };
