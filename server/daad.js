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

  /* The hundred added with the Germany/UK sheet of 6 September 2026. Not in
     the DAAD's list at all, so no id and no link: Clausthal, HS Mannheim, HS
     Düsseldorf, Westphalian, Ruhr West, HS Hannover, HTW Dresden, HTWK Leipzig,
     Zittau/Görlitz. */
  'ludwig-maximilian-university-of-munich': 183,
  'heidelberg-university': 119,
  'humboldt-university-of-berlin': 12,
  'free-university-of-berlin': 11,
  'technical-university-of-berlin': 13,
  'university-of-hamburg': 104,
  'technical-university-of-dresden': 53,
  'university-of-bonn': 32,
  'university-of-gottingen': 98,
  'university-of-tubingen': 258,
  'university-of-cologne': 147,
  'goethe-university-frankfurt': 78,
  'university-of-munster': 191,
  'university-of-wurzburg': 276,
  'leibniz-university-hannover': 114,
  'technical-university-of-braunschweig': 35,
  'university-of-bremen': 38,
  'kiel-university': 144,
  'friedrich-schiller-university-jena': 133,
  'leipzig-university': 159,
  'university-of-konstanz': 154,
  'johannes-gutenberg-university-mainz': 174,
  'university-of-hohenheim': 129,
  'university-of-potsdam': 221,
  'university-of-duisburg-essen': 71,
  'heinrich-heine-university-dusseldorf': 59,
  'university-of-regensburg': 225,
  'university-of-bayreuth': 9,
  'university-of-passau': 218,
  'university-of-augsburg': 6,
  'university-of-bamberg': 8,
  'university-of-siegen': 245,
  'university-of-kassel': 142,
  'university-of-marburg': 179,
  'university-of-oldenburg': 209,
  'osnabruck-university': 211,
  'otto-von-guericke-university-magdeburg': 172,
  'tu-bergakademie-freiberg': 85,
  'technische-universitat-ilmenau': 130,
  'rptu-kaiserslautern-landau': 135,
  'saarland-university': 235,
  'university-of-greifswald': 99,
  'university-of-wuppertal': 279,
  'hamburg-university-of-technology': 105,
  'university-of-hildesheim': 127,
  'brandenburg-university-of-technology-cottbus-senftenberg': 45,
  'university-of-erfurt': 66,
  'university-of-koblenz': 146,
  'leuphana-university-luneburg': 171,
  'munich-university-of-applied-sciences': 291,
  'karlsruhe-university-of-applied-sciences': 138,
  'esslingen-university-of-applied-sciences': 73,
  'furtwangen-university': 94,
  'offenburg-university-of-applied-sciences': 208,
  'pforzheim-university': 219,
  'heilbronn-university-of-applied-sciences': 125,
  'reutlingen-university': 227,
  'technische-hochschule-ulm': 260,
  'kempten-university-of-applied-sciences': 143,
  'technical-university-of-applied-sciences-augsburg': 7,
  'technical-university-of-applied-sciences-rosenheim': 232,
  'landshut-university-of-applied-sciences': 157,
  'ansbach-university-of-applied-sciences': 312,
  'hof-university-of-applied-sciences': 287,
  'nuremberg-institute-of-technology': 200,
  'technical-university-of-applied-sciences-wurzburg-schweinfurt': 277,
  'aschaffenburg-university-of-applied-sciences': 333,
  'fulda-university-of-applied-sciences': 92,
  'frankfurt-university-of-applied-sciences': 79,
  'rheinmain-university-of-applied-sciences': 270,
  'technische-hochschule-mittelhessen': 97,
  'th-koln-university-of-applied-sciences': 149,
  'bonn-rhein-sieg-university-of-applied-sciences': 294,
  'fh-aachen-university-of-applied-sciences': 2,
  'rhine-waal-university-of-applied-sciences': 400,
  'bochum-university-of-applied-sciences': 30,
  'osnabruck-university-of-applied-sciences': 214,
  'ostfalia-university-of-applied-sciences': 36,
  'jade-university-of-applied-sciences': 25094,
  'emden-leer-university-of-applied-sciences': 405,
  'bremerhaven-university-of-applied-sciences': 41,
  'flensburg-university-of-applied-sciences': 77,
  'kiel-university-of-applied-sciences': 145,
  'technische-hochschule-lubeck': 169,
  'wismar-university-of-applied-sciences': 274,
  'stralsund-university-of-applied-sciences': 247,
  'anhalt-university-of-applied-sciences': 5,
  'magdeburg-stendal-university-of-applied-sciences': 173,
  'mittweida-university-of-applied-sciences': 181,
  'ernst-abbe-university-of-applied-sciences-jena': 134,
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
