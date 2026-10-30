'use strict';
/*
 * One page per university, from the catalogue.
 *
 * "Every university we have on our website should have a page with details
 *  which opens once someone clicks More details. It should not render with
 *  the initial pages. A details page and SEO will help attract students, and
 *  it should have an apply option."
 *
 * The catalogue is a list of PROGRAMMES — 171 rows at 51 universities — and a
 * student searching Google types the name of a university. So this groups the
 * rows by university and gives each one an address, /university/<slug>, which
 * the server renders on request from the live catalogue: nothing is baked
 * into index.html, a university added on the Catalogue screen has a page the
 * same minute, and a programme taken off the site leaves its page.
 *
 * The slug is the name, made safe, and NOT stored: a university has no row of
 * its own to store it on, and deriving it the same way everywhere (here, and
 * in the finder's "More details" link) means the two cannot disagree. The
 * cost is that renaming a university moves its page — which is also true of
 * every other page on the site and is what the old address redirecting to
 * /university is for.
 *
 * What the office writes ABOUT a university — a paragraph, a picture, a title
 * for search — lives in the content table under `university:<slug>`, so it is
 * kept when the programmes under it change and edited from the Catalogue
 * screen without a developer.
 */

const LOGOS = require('./logos.js');

/* 22 Oct: the home pages the site ships with, for the universities whose
   course links give nothing to go on (a university that is only on the site
   through a partner's or a joint programme's pages) or give the wrong thing
   (Reutlingen's links all sit on its business school's site). Looked up and
   checked by hand; assets/university-websites.json, keyed by slug:
     { "<slug>": { "url", "name", "source", "checked" } }
   Consulted after the office's own address and before the course-link
   heuristic in group(). A missing or unreadable file is an empty list. */
const WEBSITES = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'university-websites.json'), 'utf8')) || {}; }
  catch (e) { return {}; }
})();
/* Round 15 Oct (12): derivations known to be wrong, fixed in code — the
   Film University Babelsberg's course links sit on uni-potsdam.de (a joint
   programme), so the guess sent its page to the University of Potsdam. */
const KNOWN_SITES = {
  'film-university-babelsberg-konrad-wolf': 'https://www.filmuniversitaet.de',
};
const builtinWebsite = slug => {
  const w = WEBSITES[slug];
  if (w && /^https?:\/\//i.test(String(w.url || ''))) return String(w.url);
  return KNOWN_SITES[slug] || '';
};

/** The address a university's name becomes. Identical in the finder script. */
const slugOf = name => String(name || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

/* The next time this day-and-month comes round — the same arithmetic the
   finder uses, so a deadline reads the same on both pages. */
function nextOn(deadline, today) {
  const d = new Date(String(deadline || ''));
  if (isNaN(d)) return null;
  const t = today ? new Date(today) : new Date();
  t.setHours(0, 0, 0, 0);
  const out = new Date(t.getFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (out < t) out.setFullYear(out.getFullYear() + 1);
  return out;
}

const LEVELS = { bachelor: "Bachelor's", master: "Master's", mba: 'MBA', diploma: 'Diploma',
  foundation: 'Foundation / pathway', pathway: 'Foundation / pathway', phd: 'PhD' };
const levelOf = l => LEVELS[String(l || '').toLowerCase()] || (l ? String(l) : "Master's");

/* Round 169 (WEB-05). The part of a host name a university registers:
   rwth-aachen.de from www.rwth-aachen.de, lancaster.ac.uk from
   www.lancaster.ac.uk. */
const TWO_LEVEL = new Set(['ac.uk', 'co.uk', 'org.uk', 'ac.in', 'edu.in', 'co.in', 'edu.au', 'com.au', 'ac.nz', 'co.nz',
  'edu.sg', 'com.sg', 'ac.jp', 'co.jp', 'ac.at', 'edu.pl', 'com.pl', 'edu.es', 'ac.cy', 'edu.mt', 'ac.ie']);
function registrableDomain(host) {
  const parts = String(host || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length < 2) return '';
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL.has(last2) && parts.length >= 3 ? parts.slice(-3).join('.') : last2;
}
/* Sites that carry other people's programmes — joint-degree, portal and
   partner sites a course link may point at, never a university's own home. */
const AGGREGATORS = new Set(['daad.de', 'mastersportal.com', 'studyportals.com', 'uni-assist.de', 'hochschulkompass.de',
  'study-in-germany.de', 'studycheck.de', 'university-in-germany.com', 'femp.org', 'tubadvancedmasters.de', 'mastermercuri.eu',
  'coopdesignresearch.de', 'mba-renewables.de', 'graduatecenter.org', 'europeannewschool.eu', 'multicom-em.eu',
  'master-emmah.eu', 'vinifera-euromaster.eu', 'hipercoach.net', '3dmm2o.de', 'ec-nantes.fr', 'master-asc.eu',
  'master-international-law-erasmusmundus.eu', 'lmu-klinikum.de', 'mba-ibc.com',
  'international-academy-for-german-engineering.de', 'goethe-business-school.de', 'eacea.ec.europa.eu', 'europa.eu',
  'google.com', 'bit.ly', 'linkedin.com', 'facebook.com', 'youtube.com']);

/**
 * The catalogue as universities. Rows the office has switched off are already
 * absent from the catalogue handed in. Sorted by name within country.
 */
function group(catalogue) {
  const by = new Map();
  for (const p of catalogue || []) {
    if (!p || !p.university) continue;
    const slug = slugOf(p.university);
    if (!slug) continue;
    let u = by.get(slug);
    if (!u) {
      u = { slug, name: String(p.university).trim(), shortName: '', city: '', country: p.country || '',
        isPublic: !!p.isPublic, feeModel: '', url: '', logo: '', programmes: [] };
      by.set(slug, u);
    }
    if (!u.shortName && p.shortName) u.shortName = String(p.shortName).trim();
    if (!u.city && p.city) u.city = String(p.city).trim();
    /* Its logo, when logos/ has one — '' otherwise, and the pages draw the
       initials tile they always did (server/logos.js). */
    if (!u.logo) u.logo = LOGOS.logoFor(u.name, u.shortName);
    if (/^https?:\/\//i.test(String(p.url || ''))) {
      /* Round 169 (WEB-05): counted, not first-come. The university's own
         site is the registrable domain MOST of its course pages sit on —
         RWTH's first programme link was femp.org, a joint programme's site,
         and "fewest dots" chose it over www.rwth-aachen.de. */
      try {
        const o = new URL(p.url);
        const d = registrableDomain(o.hostname);
        if (d && !AGGREGATORS.has(d)) {
          u._sites = u._sites || new Map();
          const s = u._sites.get(d) || { n: 0, origins: new Map() };
          s.n++;
          s.origins.set(o.origin, (s.origins.get(o.origin) || 0) + 1);
          u._sites.set(d, s);
        }
      } catch (e) { /* leave it */ }
    }
    const fm = p.feeModel === 'free' || p.feeModel === 'package' ? p.feeModel
      : (p.isPublic ? 'package' : 'free');
    if (!u.feeModel) u.feeModel = fm;
    u.programmes.push(p);
  }
  const out = [...by.values()];
  for (const u of out) {
    /* The most common domain; on a tie, the one whose name shares a word with
       the university's. Within it, the plainest address — www.x.de over
       mathinf.x.de — as the home page. */
    if (u._sites) {
      /* A domain that carries the university's own name (or its initials —
         kit.edu, fau.eu, hhu.de) beats a busier one that does not: Bremen
         UAS lists more courses on a joint-degree site than on hs-bremen.de. */
      const words = String(u.name + ' ' + u.shortName).replace(/\([^)]*\)/g, ' ').normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .split(/[^A-Za-z0-9]+/).filter(Boolean);
      const nameToks = new Set(words.map(w => w.toLowerCase()).filter(w => w.length > 2));
      const sig = words.filter(w => !/^(of|the|and|for|in|at|de|der|die|des|fur|und|am)$/i.test(w));
      if (sig.length >= 2) {
        nameToks.add(sig.map(w => w[0]).join('').toLowerCase());
        nameToks.add(sig.slice(0, -1).map(w => w[0]).join('').toLowerCase());
      }
      /* koeln = köln: umlauts typed out, folded both sides. */
      const ue = w => w.replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a');
      [...nameToks].forEach(w => nameToks.add(ue(w)));
      const looksLike = d => d.split(/[.-]/).some(w => nameToks.has(w) || nameToks.has(ue(w))) ? 1 : 0;
      const [dom, s] = [...u._sites.entries()].sort((a, b) => looksLike(b[0]) - looksLike(a[0]) || b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
      const plain = h => { const host = new URL(h).hostname; return host === dom || host === 'www.' + dom ? 0 : (host.match(/\./g) || []).length; };
      const origin = [...s.origins.keys()].sort((a, b) => plain(a) - plain(b) || a.localeCompare(b))[0];
      const host = new URL(origin).hostname;
      /* The home page, not a department's: www.kit.edu, not www.agw.kit.edu. */
      u.url = host === dom || host === 'www.' + dom ? origin : new URL(origin).protocol + '//www.' + dom;
      delete u._sites;
    }
    /* 22 Oct: a shipped home page beats the guess from the course links;
       the office's own address (serve.js, x.website) still beats both. */
    if (builtinWebsite(u.slug)) u.url = builtinWebsite(u.slug);
    /* The main campus, not the first row's city (patch 145): TUM showed as
       "Public university in Straubing", WHU as Düsseldorf, TH Köln as
       Gummersbach. A city named in the university's own name wins; otherwise
       the city most of its programmes are in. */
    {
      const n = new Map();
      u.programmes.forEach(p => { const c = String(p.city || '').trim(); if (c) n.set(c, (n.get(c) || 0) + 1); });
      const nameLc = u.name.toLowerCase();
      const named = [...n.keys()].find(c => nameLc.includes(c.toLowerCase().split(/[\s,(/]/)[0]));
      const most = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
      if (named) u.city = named; else if (most) u.city = most[0];
    }
    /* On the site — in the finder and on the lists — if ANY of its programmes
       is. A university whose every programme is search-only is reached from
       Google and the search box, and from nowhere else. */
    u.listed = u.programmes.some(p => !p.searchOnly);
    /* Round 178: an agent-portal import (every row's fee indicative) is
       stored non-public only so its name is not locked — whether it IS
       public or private is not known, and no page says either (typeLabel).
       Its fees are a counsellor's: `feeOnRequest`. */
    u.typeKnown = u.programmes.some(p => !indicativeRow(p));
    u.feeOnRequest = !u.typeKnown;
    if (u.typeKnown) u.isPublic = !!u.programmes.find(p => !indicativeRow(p)).isPublic;
    /* Round 30 Sep (issue 1): a PRIVATE programme with no fee entered is not
       free — it is unknown. It is left out of the range, so EBS is not
       "no tuition on some programmes". */
    /* Round 178: an indicative (agent-portal) or withheld fee is not a
       known one — it never reaches the range a public page prints. */
    const known = u.programmes.filter(p => !p.feeIndicative && !p.feeHidden
      && (p.isPublic || Number(p.totalInr) > 0 || (p.reqs && p.reqs.tuitionEurSem === 0)));
    const fees = known.map(p => Number(p.totalInr) || 0);
    u.feeMin = fees.length ? Math.min(...fees) : null;
    u.feeMax = fees.length ? Math.max(...fees) : null;
    u.tuitionFree = known.length ? fees.some(f => f === 0) : false;
    u.levels = [...new Set(u.programmes.map(p => levelOf(p.level)))];
    u.fields = [...new Set(u.programmes.map(p => p.field).filter(Boolean))];
    u.seasons = [...new Set(u.programmes.flatMap(p => (p.intakes || [])
      .map(i => i && i.season).filter(Boolean)))];
    const cg = u.programmes.map(p => p.minCgpa).filter(x => x != null && !isNaN(x));
    u.minCgpa = cg.length ? Math.min(...cg) : null;
    const gg = u.programmes.map(p => p.germanGpa).filter(x => x != null && !isNaN(x));
    u.germanGpa = gg.length ? Math.max(...gg) : null;
    u.programmes.sort((a, b) => String(a.program).localeCompare(String(b.program)));
  }
  return out.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
}

const find = (catalogue, slug) => group(catalogue).find(u => u.slug === String(slug)) || null;

/** What the office may write about one university. Everything optional. */
function cleanExtras(v) {
  const o = v && typeof v === 'object' ? v : {};
  const str = (x, n) => String(x == null ? '' : x).trim().slice(0, n);
  return {
    about: str(o.about, 6000),
    cover: str(o.cover, 400),
    metaTitle: str(o.metaTitle, 120),
    metaDesc: str(o.metaDesc, 320),
    /* The DAAD institution number, or a daad.de address. See daad.js. */
    daad: str(o.daad, 300),
    /* Round 169 (WEB-05): the university's own home page, when the office
       has set it — otherwise the page works it out from the course links
       (group(), above). Only an http(s) address. */
    website: /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(str(o.website, 300)) ? str(o.website, 300) : '',
    /* The office can take one page off search without taking the university
       off the finder — a page with nothing written on it yet, say. */
    hidden: !!o.hidden,
  };
}

const money = n => {
  const v = Number(n) || 0;
  if (!v) return '₹0';
  /* Round 169: ₹13,99,950 is "₹14 lakh", not "₹14.0 lakh". */
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(v % 1e7 ? 1 : 0).replace(/\.0$/, '') + ' crore';
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(v % 1e5 ? 1 : 0).replace(/\.0$/, '') + ' lakh';
  return '₹' + v.toLocaleString('en-IN');
};

/**
 * A database row as the programme object the finder, the matcher and the
 * pages are handed. One mapper, so a column added to the table reaches every
 * consumer or none — the shape of bug that column-by-column mapping breeds.
 */
const crypto = require('crypto');
const REQS = require('./reqs.js');
const uKeyOf = name => 'u' + crypto.createHash('sha1').update(String(name || '').trim().toLowerCase()).digest('hex').slice(0, 8);
/* CNS-07 (7): "MEngEngineering and Sustainable…" came in from the sheet with
   the degree glued to the name. A degree abbreviation at the START of a word,
   run straight into a capitalised word, gets its space back. "(MScIH)" — no
   lowercase after the capitals — is left as it is. */
const spaceDegree = s => String(s == null ? '' : s)
  .replace(/(^|[\s(/,-])(MEng|MSc|MBA|MA|MS|MEd|MFA|MPH|LLM|BSc|BEng|BA|BBA|PhD)(?=[A-Z][a-z])/g, '$1$2 ');
function fromRow(r) {
  return {
    id: r.id, program: spaceDegree(r.program), university: r.university, city: r.city || '',
    country: r.country, level: r.level || '', field: r.field || '', band: r.band || '',
    isPublic: !!r.is_public, fit: r.fit || null, totalInr: r.total_inr || 0,
    feeModel: r.fee_model === 'free' || r.fee_model === 'package' ? r.fee_model : (r.is_public ? 'package' : 'free'),
    minCgpa: r.min_cgpa == null ? null : Number(r.min_cgpa),
    germanGpa: r.german_gpa == null ? null : Number(r.german_gpa),
    url: r.url || '',
    shortName: r.short_name || '',
    uKey: uKeyOf(r.university),
    featured: !!r.featured, featureSort: r.feature_sort || 0,
    searchOnly: !!r.search_only,
    intakes: (() => { try { return JSON.parse(r.intakes) || []; } catch (e) { return []; } })(),
    /* What it asks for beyond a grade. One record, every field present,
       null where nobody has stated it — server/reqs.js owns the list. */
    reqs: REQS.parse(r.reqs),
    /* The office's tags, as a list. Empty until imported; server/tags.js
       derives a set from the other fields when it is. */
    tags: String(r.tags || '').split(';').map(t => t.trim()).filter(Boolean),
    /* Round 178: the fee came from an agent portal (Crizac, ApplyBoard,
       UCOL) — indicative, for counsellors only. Every public reader strips
       it (publicFee below; api.js /api/catalogue). */
    feeIndicative: !!r.fee_indicative,
    /* Round 178 (F8): who awards the degree, when not the campus itself. */
    awardingBody: r.awarding_body || '',
  };
}

/* Round 178: a programme as a visitor or a student may see it. An
   indicative fee is withheld whole — the total, the per-semester figure and
   the budget band it implies — and the row says so (`feeHidden`). Anything
   else is returned untouched. */
function publicFee(p) {
  if (!p || !p.feeIndicative) return p;
  const reqs = p.reqs && typeof p.reqs === 'object' ? Object.assign({}, p.reqs, { tuitionEurSem: null }) : p.reqs;
  return Object.assign({}, p, { totalInr: 0, freeTuition: false, feeHidden: true, feeIndicative: true, band: '', reqs });
}

/* Round 178: 'Public' | 'Private' | '' for a grouped university (group())
   or a single row. '' when its status is not known — a university whose
   every row came from an agent portal (fee indicative), or such a row. The
   finder's browser copy is FIND.typeLabel (server/find.js), same rule. */
function indicativeRow(p) {
  return !!(p && (p.feeIndicative === true || p.feeIndicative === 1 || p.feeIndicative === 'yes'
    || p.fee_indicative === 1 || p.fee_indicative === true || /agent/i.test(String(p.feeSource || p.fee_source || ''))));
}
function typeLabel(x) {
  if (!x) return '';
  const known = x.typeKnown !== undefined ? !!x.typeKnown
    : Array.isArray(x.programmes) ? x.programmes.some(p => !indicativeRow(p)) : !indicativeRow(x);
  if (!known) return '';
  return (x.isPublic || x.is_public) ? 'Public' : 'Private';
}

module.exports = { slugOf, group, find, cleanExtras, nextOn, levelOf, money, LEVELS, fromRow, uKeyOf, spaceDegree, publicFee, typeLabel, indicativeRow };
