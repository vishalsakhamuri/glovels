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
  pathway: 'Foundation / pathway', phd: 'PhD' };
const levelOf = l => LEVELS[String(l || '').toLowerCase()] || (l ? String(l) : "Master's");

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
        isPublic: !!p.isPublic, feeModel: '', url: '', programmes: [] };
      by.set(slug, u);
    }
    if (!u.shortName && p.shortName) u.shortName = String(p.shortName).trim();
    if (!u.city && p.city) u.city = String(p.city).trim();
    if (!u.url && /^https?:\/\//i.test(String(p.url || ''))) {
      /* The university's own site, from the first course page: everything
         up to the first path segment. */
      try { u.url = new URL(p.url).origin; } catch (e) { /* leave it */ }
    }
    const fm = p.feeModel === 'free' || p.feeModel === 'package' ? p.feeModel
      : (p.isPublic ? 'package' : 'free');
    if (!u.feeModel) u.feeModel = fm;
    u.programmes.push(p);
  }
  const out = [...by.values()];
  for (const u of out) {
    const fees = u.programmes.map(p => Number(p.totalInr) || 0);
    u.feeMin = Math.min(...fees);
    u.feeMax = Math.max(...fees);
    u.tuitionFree = fees.some(f => f === 0);
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
    /* The office can take one page off search without taking the university
       off the finder — a page with nothing written on it yet, say. */
    hidden: !!o.hidden,
  };
}

const money = n => {
  const v = Number(n) || 0;
  if (!v) return '₹0';
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(v % 1e7 ? 1 : 0) + ' crore';
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(v % 1e5 ? 1 : 0) + ' lakh';
  return '₹' + v.toLocaleString('en-IN');
};

module.exports = { slugOf, group, find, cleanExtras, nextOn, levelOf, money, LEVELS };
