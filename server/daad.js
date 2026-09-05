'use strict';
/*
 * The DAAD page for a German university.
 *
 * "We need to connect the DAAD page for every university."
 *
 * The DAAD's International Programmes database is the reference every Indian
 * student applying to Germany already knows, and a university page that links
 * to it says: what we list here is what Germany's own agency lists. The DAAD
 * has no profile page per university; what it has is the search, filtered by
 * institution — one id per university, in the `ins[]` parameter — which lists
 * every international programme that institution offers. That is the link.
 *
 * The ids below were read from the institution filter on
 * www2.daad.de/deutschland/studienangebote/international-programmes on
 * 5 September 2026, for every German university in the catalogue. Keyed by
 * the university's page slug (server/unis.js), so a rename of the catalogue
 * row moves the page and the link together. A university that is not here
 * gets its id typed on the Catalogue → University pages tab, and what is typed
 * there wins over this list.
 */

const BASE = 'https://www2.daad.de/deutschland/studienangebote/international-programmes/en/result/';

const DAAD_IDS = {
  'bauhaus-universitat-weimar': 266,
  'bht-berlin-berliner-hochschule-fur-technik': 15,
  'bielefeld-university': 27,
  'coburg-university-of-applied-sciences-and-arts': 44,
  'constructor-university': 327,
  'darmstadt-university-of-applied-sciences-h-da': 47,
  'deggendorf-institute-of-technology-th-deggendorf': 284,
  'th-deggendorf': 284,
  'european-university-viadrina-frankfurt-oder': 84,
  'fau-erlangen-nuremberg': 70,
  'fau-erlangen-nurnberg': 70,
  'fh-dortmund': 52,
  'fh-south-westphalia-sudwestfalen': 343,
  'haw-hamburg': 107,
  'hs-aalen': 3,
  'hs-bremen': 40,
  'htw-berlin': 16,
  'iu-international-university': 387,
  'justus-liebig-university-giessen': 96,
  'karlsruhe-institute-of-technology': 136,
  'martin-luther-university-halle-wittenberg': 101,
  'oth-regensburg': 226,
  'ru-bochum': 29,
  'rwth-aachen-university': 1,
  'schmalkalden-university-of-applied-sciences': 242,
  'srh-berlin-university-of-applied-sciences': 345,
  'th-bingen': 304,
  'th-ingolstadt': 288,
  'tu-chemnitz': 42,
  'tu-darmstadt': 46,
  'tu-dortmund': 51,
  'tu-dortmund-university': 51,
  'tu-munich': 184,
  'ulm-university': 259,
  'uni-trier': 255,
  'university-of-freiburg': 86,
  'university-of-lubeck': 168,
  'university-of-mannheim': 176,
  'university-of-rostock': 233,
  'university-of-stuttgart': 248,
  'university-paderborn': 215,
};

/** The listing of every international programme at one institution. */
const urlFor = id => BASE + '?ins%5B%5D=' + encodeURIComponent(String(id)) + '&display=list';

/**
 * What the office typed, or the shipped id. Accepts a bare id ("248"), a
 * DAAD address of any shape, or nothing. Returns a URL or ''.
 */
function daadUrl(slug, typed) {
  const t = String(typed || '').trim();
  if (/^\d{1,6}$/.test(t)) return urlFor(t);
  if (/^https:\/\/(?:www2?\.)?daad\.de\//i.test(t)) return t;
  const id = DAAD_IDS[String(slug || '')];
  return id ? urlFor(id) : '';
}

/** null when a typed value is acceptable, or the sentence saying why not. */
function refuse(typed) {
  const t = String(typed || '').trim();
  if (!t || /^\d{1,6}$/.test(t) || /^https:\/\/(?:www2?\.)?daad\.de\//i.test(t)) return null;
  return 'The DAAD link has to be the institution number from the DAAD search (for '
    + 'example 248), or an address on daad.de.';
}

module.exports = { DAAD_IDS, daadUrl, urlFor, refuse, BASE };
