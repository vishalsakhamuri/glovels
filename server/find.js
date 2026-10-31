/*
 * Find University — the page at /find-university.
 *
 * One module, two readers: serve.js renders the first page of results with it
 * (so Google and a visitor with scripts off see real rows), and the browser
 * loads the same file at /js/find.js and re-renders on every filter change.
 * That is why nothing here touches `require` at the top level, `document`,
 * or `fs` — it is plain functions over plain rows, and the one dependency
 * (the requirement checker in reqs.js) is handed in by whoever calls.
 *
 * The rows are what /api/catalogue returns: a public university's name and
 * fee are withheld until a package covers them, and this page renders a
 * locked row exactly as the home page does — a blurred placeholder and the
 * country, never the name. The gating is the server's; this file only draws.
 *
 * The address is the state. Every filter is a query parameter, named the way
 * the home-page finder names its boxes (country, level, field, cgpa, intake,
 * english, work, gre, …), so the "More universities →" button can hand its
 * filters straight over and a search can be bookmarked or shared.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FIND = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const has = v => v != null && String(v).trim() !== '';
  const reqsOf = p => (p && p.reqs && typeof p.reqs === 'object') ? p.reqs : {};

  /* ----------------------------------------------------------- the filters */

  /* The keys the address may carry, in the order the chips show them. The
     first group narrows the catalogue; the second is what the visitor told
     us about themselves and is checked against each row's requirements. */
  /* Round 176: `ggpa` — the visitor's German grade (1.0 best, 4.0 pass),
     the home page's calculator answer — narrows the way the home page
     does: a row that STATES a German grade better than theirs is out. */
  /* Round 178 (F2): no `bachelorYears` (ECTS only) and no `greScore` (the
     GRE is yes/no plus the three sections). `moiLetter` = "I have an MOI
     letter", beside a test score — IELTS 6 with a letter in hand (F6.5). */
  const KEYS = ['country', 'level', 'field', 'apply', 'tuition', 'intake', 'moi', 'nogre', 'restricted', 'ggpa',
    'cgpa', 'english', 'moiLetter', 'work', 'gre', 'greQuant', 'greVerbal', 'greAwa', 'german',
    'ects', 'topPercent', 'papers', 'tags', 'q', 'sort', 'view'];
  /* Round 178 (F7.4, owner 30 Oct): the filters only the Germany sheet
     answers — the German grade, the German level, restricted admission and
     the bachelor's ECTS (with its 3-year rule). A non-German destination
     drops them from the address and the screens hide their boxes. */
  const GERMANY_ONLY = ['ggpa', 'german', 'restricted', 'ects'];
  const germanyOnlyOff = f => !!(f && f.country && String(f.country).toUpperCase() !== 'DE');

  /* 10 Oct: the tag search (server/tags.js) — required under Node, found on
     window in the browser, and looked up when needed so the two scripts may
     load in either order. Without it `tags` and `q` fall back to a plain
     name search. */
  const tagsModule = () => {
    try { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./tags.js'); } catch (e) { /* no module */ }
    try { return (typeof self !== 'undefined' ? self : this).TAGS || null; } catch (e) { return null; }
  };
  const tagList = v => String(v || '').split(';').map(t => t.trim()).filter(Boolean);
  /* Set for the length of one run(): the universities the search box names. */
  let uniKeys = null;
  /* Round 169 (WEB-06): the MOI box and the typed "MOI Accepted" tag read the
     same thing — the requirement, or the office's own tag on the row
     (tags.js FEATURES). */
  const moiOk = p => !!(p && ((p.reqs && p.reqs.moiAccepted === true)
    || (Array.isArray(p.tags) && p.tags.some(t => String(t || '').trim().toLowerCase() === 'moi accepted'))));

  /* Round 176 (owner, go-live): "students should not know how many
     universities are in the filter at the back end". A viewer without a
     package never receives the whole locked set — /api/catalogue and
     /api/find/locked hand over at most LOCKED_CAP placeholders per response,
     and every page draws at most that many locked rows. The count of what
     is behind them is never sent or shown; `more` says only that the cap
     was hit. */
  const LOCKED_CAP = 12;
  /* The locked rows of a list, capped. Named rows all stay, in place; of the
     locked ones at most `cap` are kept, taken one per (country, level,
     field) group in turn so a visitor's likely filters are each covered
     rather than the first twelve of one kind. Order within the kept rows is
     the order they came in. Returns { rows, more } — `more` is true when a
     locked row was dropped; never how many. */
  function capLocked(rows, cap) {
    cap = Number(cap == null ? LOCKED_CAP : cap);
    const lockedRows = rows.filter(p => (p._locked !== undefined ? p._locked : locked(p)));
    if (lockedRows.length <= cap) return { rows: rows.slice(), more: false };
    const groups = new Map();
    lockedRows.forEach(p => { const k = [p.country, levelKey(p.level), p.field].join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    const keep = new Set();
    const lists = [...groups.values()];
    for (let round = 0; keep.size < cap; round++) {
      let any = false;
      for (const g of lists) { if (keep.size >= cap) break; if (round < g.length) { keep.add(g[round]); any = true; } }
      if (!any) break;
    }
    return { rows: rows.filter(p => !(p._locked !== undefined ? p._locked : locked(p)) || keep.has(p)), more: true };
  }
  /* The values the filter boxes may offer — every country, level, field
     and open term across `rows`, as lists, with no count on any of them.
     What /api/catalogue sends so the boxes are complete without the rows. */
  function facetValues(rows) {
    const uniq = (list) => [...new Set(list.filter(Boolean))].sort();
    const terms = upcomingTerms(4).filter(t => rows.some(p => openFor(p, t))).map(t => t.key);
    return {
      country: uniq(rows.map(p => p.country)),
      level: uniq(rows.map(p => levelKey(p.level))),
      field: uniq(rows.map(p => p.field)),
      intake: terms,
    };
  }

  const LEVELS = { bachelor: "Bachelor's", master: "Master's", mba: 'MBA', diploma: 'Diploma / PG Diploma', foundation: 'Foundation / Pathway', phd: 'PhD' };
  const SORTS = { deadline: 'Deadline', cost: 'Total cost', fit: 'Fit', az: 'A – Z' };

  /* From a query string, URLSearchParams, or a plain object. Unknown keys are
     dropped; `feeModel` is accepted as an alias of `apply` because that is the
     home page's name for it. */
  function parse(q) {
    const get = typeof q === 'string'
      ? (k => { const m = new RegExp('(?:^|[?&])' + k + '=([^&]*)').exec(q); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; })
      : (q && typeof q.get === 'function' ? (k => q.get(k) || '') : (k => (q && q[k] != null) ? String(q[k]) : ''));
    const f = {};
    KEYS.forEach(k => { const v = String(get(k) || '').trim(); if (v) f[k] = v.slice(0, k === 'tags' ? 1200 : 80); });
    /* The tag list, tidied: trimmed, no blanks, no repeats, 60 at most. */
    if (f.tags) { const seen = new Set(); f.tags = tagList(f.tags).filter(t => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 60).join(';'); if (!f.tags) delete f.tags; }
    const alias = String(get('feeModel') || '').trim();
    if (!f.apply && (alias === 'free' || alias === 'package')) f.apply = alias;
    if (f.apply && f.apply !== 'free' && f.apply !== 'package') delete f.apply;
    if (f.restricted && f.restricted !== 'open' && f.restricted !== 'restricted') delete f.restricted;
    if (f.sort && !SORTS[f.sort]) delete f.sort;
    if (f.view && f.view !== 'list' && f.view !== 'uni') delete f.view;
    /* Round 178 (F7.1): one level, Master's, with the MBAs under it. */
    if (f.level && f.level.toLowerCase() === 'mba') f.level = 'master';
    if (germanyOnlyOff(f)) GERMANY_ONLY.forEach(k => { delete f[k]; });
    if (f.moiLetter && !/^(1|yes|true|on)$/i.test(f.moiLetter)) delete f.moiLetter;
    return f;
  }

  /* Back to an address. Only what is set, in a stable order, so the same
     search always has the same URL. */
  function toQuery(f) {
    const parts = [];
    KEYS.forEach(k => { if (has(f[k])) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(f[k])); });
    return parts.length ? '?' + parts.join('&') : '';
  }

  /* What the visitor said about themselves, in the shape reqs.check() reads —
     the same translation the home page's myAnswers() makes from its boxes. */
  function student(f) {
    const s = {};
    const en = String(f.english || '');
    if (/^ielts:/.test(en)) s.ielts = num(en.slice(6));
    else if (/^toefl:/.test(en)) s.toefl = num(en.slice(6));
    else if (en === 'moi') s.moi = true;
    else if (en === 'none') s.englishNone = true;
    if (has(f.moiLetter)) { s.moi = true; delete s.englishNone; }
    if (f.gre === 'none') s.gre = false;
    else if (f.gre === 'yes') s.gre = 'taken';
    else if (num(f.gre) != null) s.gre = num(f.gre);
    if (s.gre !== false) {
      if (num(f.greQuant) != null) s.greQuant = num(f.greQuant);
      if (num(f.greVerbal) != null) s.greVerbal = num(f.greVerbal);
      if (num(f.greAwa) != null) s.greAwa = num(f.greAwa);
    }
    if (has(f.german)) s.germanLevel = f.german;
    if (num(f.ects) != null) s.ects = num(f.ects);
    /* Round 178 (owner): the German grade typed in wins over the CGPA's. */
    if (num(f.ggpa) != null) s.germanGrade = num(f.ggpa);
    if (num(f.topPercent) != null) s.topPercent = num(f.topPercent);
    if (num(f.work) != null) s.workExpMonths = num(f.work);
    if (f.papers === 'yes') s.papers = true; else if (f.papers === 'no') s.papers = false;
    if (f.restricted === 'open') s.restrictedOk = false;
    if (num(f.cgpa) != null) s.cgpa = num(f.cgpa);
    return s;
  }

  /* Has the visitor told us anything that can be checked? */
  const saidAnything = s => Object.keys(s).some(k => k !== 'restrictedOk');

  /* ---------------------------------------------------------------- terms */

  const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
  const termStart = (season, y) => new Date(y, /summer|spring/i.test(season) ? 3 : 9, 1);
  const seasonOf = i => /summer|spring/i.test(String((i && i.season) || '')) ? 'summer' : 'winter';
  const termByKey = k => { const m = /^(summer|winter)-(\d{4})$/.exec(String(k || '')); return m ? { key: k, season: m[1], year: Number(m[2]), start: termStart(m[1], Number(m[2])) } : null; };
  function upcomingTerms(n) {
    const out = [], T = today();
    for (let y = T.getFullYear(); out.length < n; y++) {
      ['summer', 'winter'].forEach(se => { const st = termStart(se, y); if (st > T && out.length < n) out.push({ key: se + '-' + y, season: se, year: y, start: st }); });
    }
    return out;
  }
  /* This intake's deadline for that term, or null when it is not that season. */
  function termDeadline(i, term) {
    if (!i || !i.deadline || !term || seasonOf(i) !== term.season) return null;
    const d = new Date(i.deadline);
    if (isNaN(d)) return null;
    const limit = new Date(term.start); limit.setMonth(limit.getMonth() + 1);
    let at = new Date(term.year, d.getMonth(), d.getDate());
    while (at > limit) at.setFullYear(at.getFullYear() - 1);
    return at;
  }
  const openFor = (p, term) => (p.intakes || []).some(i => { const at = termDeadline(i, term); return at && at >= today(); });
  /* The next deadline still ahead, for the row and for sorting. */
  function nextDeadline(p) {
    const T = today();
    let best = null, closed = false;
    (p.intakes || []).forEach(i => {
      if (!i || !i.deadline) return;
      for (const t of upcomingTerms(6)) {
        const at = termDeadline(i, t);
        if (!at) continue;
        if (at >= T) { if (!best || at < best) best = at; return; }
        closed = true;
      }
    });
    return { at: best, closed: closed && !best };
  }

  /* ------------------------------------------------------------- the rows */

  const locked = p => !!p.isPublic && !p.university;
  /* Round 178 (F7.1): MBA is filed under Master's on every public screen. */
  const levelKey = v => { const l = String(v || '').toLowerCase(); return l === 'mba' ? 'master' : l; };
  /* Round 178 (owner): a fee taken from an agent portal is INDICATIVE —
     the public side never shows it, filters on it or sorts by it ("Fee on
     request"); the counsellor sees it labelled. The flag is the data
     import's (`feeIndicative`, or a `feeSource`/`fee_source` naming an agent). */
  const feeIndicative = p => !!(p && (p.feeIndicative === true || p.feeIndicative === 1 || p.feeIndicative === 'yes'
    || /agent/i.test(String(p.feeSource || p.fee_source || ''))));
  /* Round 178: 'Public' | 'Private' | '' — an agent-portal row (fee
     indicative) is stored non-public so its name is not locked, but its
     real status is not known, so no label at all. Same rule as
     UNIS.typeLabel (server/unis.js). */
  const typeLabel = p => {
    if (!p) return '';
    const known = p.typeKnown !== undefined ? !!p.typeKnown : !feeIndicative(p);
    return known ? (p.isPublic ? 'Public' : 'Private') : '';
  };
  /* Round 178 (F8): the awarding body of a foreign degree, when the row has one. */
  const awardingBody = p => String((p && (p.awardingBody || p.awarding_body || reqsOf(p).awardingBody)) || '').trim();
  const feeOf = p => (p.feeModel === 'free' || p.feeModel === 'package') ? p.feeModel : (p.isPublic ? 'package' : 'free');
  const tuitionOf = p => { if (feeIndicative(p)) return null; const t = reqsOf(p).tuitionEurSem; return (t === null || t === undefined || t === '') ? null : num(t); };
  /* Does the row ask for anything at all? A green chip on a programme that
     states nothing would be a lie — the home page draws the same line. */
  const statesAny = p => num(p.minCgpa) != null || num(p.germanGpa) != null || Object.keys(reqsOf(p)).some(k => { const v = reqsOf(p)[k]; return k !== 'tuitionEurSem' && k !== 'specialisation' && v !== null && v !== undefined && v !== '' && v !== false; });
  /* "Fee to be confirmed" where nothing is stated, the way the home page says it. */
  const feeUnknown = p => !locked(p) && !feeIndicative(p) && !Number(p.totalInr || 0) && tuitionOf(p) == null && !p.freeTuition;

  /* Which rows the narrowing filters keep. `skip` leaves one key out, so a
     facet can count what it would add. */
  function keep(p, f, skip) {
    const on = k => k !== skip && has(f[k]);
    if (on('country') && p.country !== f.country) return false;
    if (on('level') && levelKey(p.level) !== levelKey(f.level)) return false;
    if (on('field') && String(p.field || '') !== f.field) return false;
    if (on('apply') && feeOf(p) !== f.apply) return false;
    if (on('tuition')) {
      const cap = num(f.tuition), t = tuitionOf(p);
      if (cap === 0) { if (t !== 0) return false; }
      else if (cap != null && t != null && t > cap) return false;
    }
    if (on('intake')) { const t = termByKey(f.intake); if (t && !openFor(p, t)) return false; }
    if (on('moi') && !moiOk(p)) return false;
    if (on('nogre') && reqsOf(p).greRequired === true) return false;
    if (on('ggpa')) { const g = num(f.ggpa), pg = num(p.germanGpa); if (g != null && pg != null && g > pg) return false; }
    if (on('restricted')) {
      const r = reqsOf(p).restricted === true || p.restricted === true;
      if (f.restricted === 'open' && r) return false;
      if (f.restricted === 'restricted' && !r) return false;
    }
    if (on('tags') || on('q')) {
      /* Round 169 (WEB-06): a university or a city typed in the box. The
         server works out which universities the words name — by name, short
         name, alias or city, the same way for a locked row as a named one —
         and hands over their keys (`uniKeys`); a locked row never carries its
         name, so the browser could not have matched it. */
      if (on('q') && uniKeys && p.uKey && uniKeys.has(String(p.uKey))) {
        const T0 = tagsModule();
        return !(on('tags') && T0 && typeof T0.match === 'function' && !T0.match(p, f.tags, ''));
      }
      const T = tagsModule();
      if (T && typeof T.match === 'function') {
        if (!T.match(p, on('tags') ? f.tags : '', on('q') ? f.q : '')) return false;
      } else {
        const hay = (String(p.program || '') + ' ' + String(p.university || '') + ' ' + String(p.city || '') + ' ' + String(p.field || '')).toLowerCase();
        const want = (on('q') ? f.q : '') + ' ' + (on('tags') ? tagList(f.tags).join(' ') : '');
        if (!want.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false;
      }
    }
    return true;
  }

  /* The verdict on one row against what the visitor said: fails / unknown /
     notes from reqs.check(), plus the CGPA bar the row itself sets. */
  /* The CGPA bar a row sets: its own, else the destination's for its kind —
     the home page's and the counsellor matcher's rule (matches.js barOf), so
     the three screens turn the same rows away. */
  function barOf(p, countries) {
    const own = num(p.minCgpa);
    if (own != null) return own;
    const c = (countries || {})[String(p.country || '').toUpperCase()] || {};
    return num(p.isPublic ? c.minCgpaPublic : c.minCgpaPrivate);
  }
  /* Round 169 (WEB-02): a row that states a GERMAN grade (1.0 best, 4.0 pass)
   * and no CGPA. Its grade is the modified Bavarian formula the counsellor
   * matcher uses (matches.js germanOf), which needs the student's pass mark —
   * and the finder only has a CGPA out of ten. So no pass mark is invented:
   * the grade is worked out at both ends of the pass marks Indian universities
   * use (4 to 6 out of 10). Worse than the bar even at the kindest pass mark,
   * the row is turned away; within it even at the strictest, it is cleared;
   * in between, nobody can say, and the row says so. */
  const PASS_KIND = 4, PASS_STRICT = 6;
  const germanFrom = (cg, pass) => (cg < pass ? null : Math.floor((1 + 3 * (10 - cg) / (10 - pass)) * 10) / 10);
  function verdict(p, s, REQS, countries) {
    const r = reqsOf(p);
    const v = REQS ? REQS.check(r, s) : { fails: [], unknown: [], notes: [], ok: true };
    const gg = num(p.germanGpa);
    if (gg != null && num(p.minCgpa) == null) {
      /* Round 178 (owner, 30 Oct): the German grade typed in wins; else the
         CGPA (out of 10) converted by the modified Bavarian formula with the
         pass at 4/10 — one answer, no range. 4.0 on the row asks nothing. */
      if (s.germanGrade != null) {
        if (s.germanGrade > gg) v.fails = [{ key: 'cgpa', label: 'German grade', want: gg.toFixed(1), have: s.germanGrade.toFixed(1) }].concat(v.fails);
      } else if (s.cgpa == null) v.unknown = v.unknown.concat(['cgpa']);
      else {
        const g = germanFrom(s.cgpa, PASS_KIND);
        if (g == null || g > gg) v.fails = [{ key: 'cgpa', label: 'German grade', want: gg.toFixed(1), have: 'CGPA ' + s.cgpa + (g != null ? ' (≈ ' + g.toFixed(1) + ')' : '') }].concat(v.fails);
      }
    } else {
      const bar = barOf(p, countries);
      if (bar != null) {
        if (s.cgpa == null) v.unknown = v.unknown.concat(['cgpa']);
        else if (s.cgpa < bar) v.fails = [{ key: 'cgpa', label: 'CGPA', want: String(bar), have: String(s.cgpa) }].concat(v.fails);
      }
    }
    v.ok = v.fails.length === 0 && v.unknown.length === 0;
    return v;
  }

  /* Round 169 (owner, 10 Oct): with no fee filter and no sort chosen, the
     first screen is a MIX — seven private rows to three public, every
     destination. Each kind keeps its own order; past the first screen the
     rest follow in the order they had. */
  const MIX_SLOTS = 40;
  function mix(rows) {
    const priv = [], pub = [];
    rows.forEach(p => (p.isPublic ? pub : priv).push(p));
    if (!priv.length || !pub.length) return rows;
    const out = [], used = new Set();
    let i = 0, j = 0;
    for (let slot = 0; slot < MIX_SLOTS && (i < priv.length || j < pub.length); slot++) {
      const wantPub = slot % 10 === 2 || slot % 10 === 5 || slot % 10 === 8;
      const take = (wantPub && j < pub.length) || i >= priv.length ? pub[j++] : priv[i++];
      out.push(take); used.add(take);
    }
    rows.forEach(p => { if (!used.has(p)) out.push(p); });
    return out;
  }

  /* Patch 161 (D4): with nothing said about themselves a visitor sees no
     fit score, so the list opens on the nearest deadline instead. */
  const defaultSort = said => said ? 'fit' : 'deadline';
  function sortRows(rows, key, said) {
    const k = SORTS[key] ? key : defaultSort(said);
    const az = p => (locked(p) ? '￿' : '') + String(p.program || '').toLowerCase() + ' ' + String(p.university || '').toLowerCase();
    const cost = p => { if (feeIndicative(p)) return 1e11; const t = tuitionOf(p); if (t != null) return t * (p.semesters || 4); const n = Number(p.totalInr || 0); return n > 0 ? n / 90 : (locked(p) ? 1e12 : 1e11); };
    const dl = p => { const d = nextDeadline(p).at; return d ? d.getTime() : 8.64e15; };
    const fit = p => Number(p.fit || 0);
    const cmp = { deadline: (a, b) => dl(a) - dl(b) || fit(b) - fit(a), cost: (a, b) => cost(a) - cost(b) || fit(b) - fit(a),
      fit: (a, b) => fit(b) - fit(a) || dl(a) - dl(b), az: (a, b) => (az(a) < az(b) ? -1 : az(a) > az(b) ? 1 : 0) }[k];
    return rows.slice().sort(cmp);
  }

  /* Everything the page needs for one address: the rows that match, the
     verdict on each, the counts, and the facets. `REQS` is the checker from
     reqs.js; without it the profile answers are shown but not checked. */
  /* `opts`: { countries, uniKeys } — the destinations' CGPA bars, and the
     universities the server matched the search box to (WEB-06). */
  function run(rows, f, REQS, opts) {
    const o = opts || {};
    uniKeys = o.uniKeys ? new Set([...o.uniKeys].map(String)) : null;
    /* Round 178 (F7.4): a non-German destination answers no Germany-only filter. */
    if (germanyOnlyOff(f) && GERMANY_ONLY.some(k => has(f[k]))) { f = Object.assign({}, f); GERMANY_ONLY.forEach(k => { delete f[k]; }); }
    const s = student(f);
    const said = saidAnything(s);
    const kept = rows.filter(p => keep(p, f));
    const out = [];
    let turned = 0;
    /* Round 15 Oct (11): the rows the CGPA bar turns away, remembered, so the
       facet counts below drop them too and add up to the results. */
    const cgpaOut = new Map();
    const turnedAway = p => {
      if (!said) return false;
      if (cgpaOut.has(p)) return cgpaOut.get(p);
      const t = verdict(p, s, REQS, o.countries).fails.length > 0;
      cgpaOut.set(p, t);
      return t;
    };
    kept.forEach(p => {
      const v = said ? verdict(p, s, REQS, o.countries) : { fails: [], unknown: [], notes: [], ok: false };
      /* Round 178 (owner, 30 Oct): "home/public/student side HIDES,
         counsellor RANKS". A row short of anything it states that the
         visitor answered — the German grade or CGPA, IELTS/TOEFL (an MOI
         letter clears only where accepted), ECTS (the 3-year rule), a GRE
         that is "Yes…", German level, work, a paper, class rank — is left
         out, not ranked lower (patch 162 is the counsellor's matcher now).
         Not stated by the row is met; not answered by the visitor is a
         question, and the row stays. */
      const away = said && v.fails.length > 0;
      if (said) cgpaOut.set(p, away);
      if (away) { turned++; return; }
      out.push(Object.assign({}, p, { _v: v, _tier: v.fails.length ? 2 : v.unknown.length ? 1 : 0, _locked: locked(p), _fee: feeOf(p), _dl: nextDeadline(p) }));
    });
    let sorted = said ? sortRows(out, f.sort, said).sort((a, b) => a._tier - b._tier) : sortRows(out, f.sort, said);
    /* The mix works inside each tier, so a row the visitor falls short of
       still ranks below every row they clear (patch 162). */
    if (!f.sort && !f.apply) {
      const tiers = [0, 1, 2].map(t => sorted.filter(p => (p._tier || 0) === t));
      /* Patch 170: inside a tier, a restricted programme ranks below the open
         ones (restriction is for ranking — Vishal, 12 Oct). */
      const isR = p => reqsOf(p).restricted === true || p.restricted === true;
      sorted = tiers.reduce((all, t) => all.concat(mix(t.filter(p => !isR(p))), mix(t.filter(isR))), []);
    }
    const unis = new Set(sorted.map(p => p.uKey || p.university || p.id)).size;
    /* Patch 180: /api/find/match needs the rows, not the option counts —
       those are a dozen more passes over every row, each through the tag
       matcher, and on a wide search they were most of the time. */
    if (o.noFacets) return { rows: sorted, total: sorted.length, unis, turned, said, student: s, facets: null };
    /* Every other active filter, the CGPA bar included — all but the facet's own key. */
    const kf = (p, key) => keep(p, f, key) && !turnedAway(p);
    const facet = (key, valueOf) => {
      const c = {};
      rows.forEach(p => { if (!kf(p, key)) return; const v = valueOf(p); if (v) c[v] = (c[v] || 0) + 1; });
      return c;
    };
    const facets = {
      country: facet('country', p => p.country),
      level: facet('level', p => levelKey(p.level)),
      field: facet('field', p => p.field),
      apply: facet('apply', p => feeOf(p)),
      tuition0: rows.filter(p => kf(p, 'tuition') && tuitionOf(p) === 0).length,
      moi: rows.filter(p => kf(p, 'moi') && moiOk(p)).length,
      nogre: rows.filter(p => kf(p, 'nogre') && reqsOf(p).greRequired !== true).length,
      open: rows.filter(p => kf(p, 'restricted') && !(reqsOf(p).restricted === true || p.restricted === true)).length,
      intake: {},
    };
    upcomingTerms(4).forEach(t => { const n = rows.filter(p => kf(p, 'intake') && openFor(p, t)).length; if (n) facets.intake[t.key] = n; });
    return { rows: sorted, total: sorted.length, unis, turned, said, student: s, facets };
  }

  /* ------------------------------------------------------------ the words */

  const fieldShort = f => String(f || '').replace(/\s*&amp;\s*/g, ' & ');
  function title(f, countries, n) {
    const lvl = LEVELS[String(f.level || '').toLowerCase()];
    const c = f.country && countries && countries[f.country] ? countries[f.country].name : '';
    let t = lvl ? lvl : 'Programmes';
    if (f.field) t += ' in ' + fieldShort(f.field);
    if (c) t += ' in ' + c;
    else if (!f.field && !lvl) t = 'Find your university';
    /* 23 Oct: no count in the title — "numbers not required" covers the
       browser tab too. n is still taken so callers need not change. */
    void n;
    return t;
  }
  function chipLabel(k, v, countries) {
    switch (k) {
      case 'country': return (countries && countries[v]) ? countries[v].name : v;
      case 'level': return LEVELS[String(v).toLowerCase()] || v;
      case 'field': return fieldShort(v);
      case 'apply': return v === 'free' ? 'Free to apply' : 'With a package';
      case 'tuition': return v === '0' ? 'No tuition fee' : 'Tuition up to €' + Number(v).toLocaleString('en-IN') + '/sem';
      case 'intake': { const t = termByKey(v); return t ? t.season.charAt(0).toUpperCase() + t.season.slice(1) + ' ' + t.year : v; }
      case 'moi': return 'MOI letter accepted';
      case 'nogre': return 'No GRE needed';
      case 'restricted': return v === 'open' ? 'Open admission only' : 'Restricted admission only';
      case 'cgpa': return 'CGPA ' + v;
      case 'ggpa': return 'German grade ' + v;
      case 'english': return /^ielts:/.test(v) ? 'IELTS ' + v.slice(6) : /^toefl:/.test(v) ? 'TOEFL ' + v.slice(6) : v === 'moi' ? 'English-medium bachelor’s' : v === 'none' ? 'No English test yet' : v;
      case 'moiLetter': return 'Has an MOI letter';
      case 'work': return v === '0' ? 'No work experience' : v + '+ months’ work';
      case 'gre': return v === 'none' ? 'GRE not taken' : v === 'yes' ? 'GRE taken' : 'GRE ' + v;
      case 'greQuant': return 'Quant ' + v;
      case 'greVerbal': return 'Verbal ' + v;
      case 'greAwa': return 'AWA ' + v;
      case 'german': return v === 'none' ? 'No German yet' : 'German ' + v;
      case 'ects': return v + ' ECTS';
      case 'topPercent': return v === '100' ? 'Below top 50%' : 'Top ' + v + '%';
      case 'papers': return v === 'yes' ? 'Published a paper' : 'No paper published';
      case 'q': return '“' + v + '”';
      /* One chip per tag is drawn by the page (data-cleartag); this is the
         one-line form for anything that wants the lot. */
      case 'tags': return tagList(v).join(' · ');
      default: return null;
    }
  }

  const money = n => { n = Number(n || 0); if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr'; if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1).replace(/\.0$/, '') + ' L'; return '₹' + n.toLocaleString('en-IN'); };
  const dateOf = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const initials = s => String(s || '').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(w => w && !/^(of|the|and|for|in|de|der|die|und)$/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'U';

  /* ------------------------------------------------------------ the logos */

  /* The logo for a university name — the browser's copy of server/logos.js,
     simplified: exact name, alias, normalised name, then a token overlap of
     at least 0.6 with a single best. It reads the index the page inlines
     (window.FIND_LOGOS = { files, aliases }) or whatever is handed in; with
     no index it answers '' and the initials tile is drawn. A row the server
     named carries `logo` already and is not looked up. Keep the
     normalisation in step with the server's. */
  const LOGO_STOP = { university: 1, universitat: 1, univ: 1, uni: 1, of: 1, the: 1, and: 1, for: 1, in: 1, at: 1, applied: 1, sciences: 1, science: 1, arts: 1,
    hochschule: 1, fachhochschule: 1, fh: 1, hs: 1, uas: 1, fur: 1, und: 1, der: 1, die: 1, des: 1, college: 1, school: 1, campus: 1, gmbh: 1, ag: 1, ev: 1, e: 1, v: 1 };
  const LOGO_TECH = { technische: 1, technology: 1, technical: 1, tu: 1, th: 1 };
  const LOGO_CITY = { munich: 'munchen', nuremberg: 'nurnberg', cologne: 'koln', hanover: 'hannover', brunswick: 'braunschweig', berliner: 'berlin', frankfurter: 'frankfurt', hamburger: 'hamburg' };
  function logoTokens(name) {
    let t = String(name || '').toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
    t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ');
    t = t.replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a');
    return t.split(' ').map(w => LOGO_TECH[w] ? 'tech' : (LOGO_CITY[w] || w)).filter(w => w && !LOGO_STOP[w]);
  }
  let logoIdx = null;   /* { src, exact, norm, entries, cache } */
  function logoIndex(raw) {
    const src = raw || (typeof self !== 'undefined' && self.FIND_LOGOS) || null;
    if (!src || typeof src !== 'object') return null;
    if (logoIdx && logoIdx.src === src) return logoIdx;
    const exact = {}, norm = {}, entries = [];
    const put = (name, file) => {
      if (!file || !name) return;
      if (!exact[name]) exact[name] = file;
      const toks = logoTokens(name);
      if (!toks.length) return;
      const k = toks.join(' ');
      if (!norm[k]) norm[k] = file;
      entries.push({ file, toks });
    };
    Object.keys(src.files || {}).forEach(n => put(n, src.files[n]));
    Object.keys(src.aliases || {}).forEach(f => (src.aliases[f] || []).forEach(a => put(a, f)));
    logoIdx = { src, exact, norm, entries, cache: {} };
    return logoIdx;
  }
  function logoFile(L, name) {
    const n = String(name || '').trim();
    if (!n) return '';
    if (L.exact[n]) return L.exact[n];
    const toks = logoTokens(n);
    if (!toks.length) return '';
    const k = toks.join(' ');
    if (L.norm[k]) return L.norm[k];
    let best = null, bestScore = 0, tie = false;
    L.entries.forEach(e => {
      let both = 0;
      toks.forEach(t => { if (e.toks.indexOf(t) >= 0) both++; });
      const sc = both / (toks.length + e.toks.length - both);
      if (sc > bestScore) { best = e; bestScore = sc; tie = false; }
      else if (sc === bestScore && best && e.file !== best.file) tie = true;
    });
    return best && bestScore >= 0.6 && !tie ? best.file : '';
  }
  /** '/logos/<file>' or ''. `index` is optional — the inlined one is used. */
  function logoFor(name, shortName, index) {
    const L = logoIndex(index);
    if (!L) return '';
    const ck = String(name || '') + '\u0000' + String(shortName || '');
    if (L.cache[ck] !== undefined) return L.cache[ck];
    const n = String(name || '');
    const paren = /^([^()]+)\(([^()]+)\)\s*$/.exec(n);
    const f = logoFile(L, n) || (paren ? logoFile(L, paren[1]) || logoFile(L, paren[2]) : '') || logoFile(L, shortName);
    return (L.cache[ck] = f ? '/logos/' + encodeURIComponent(f) : '');
  }
  /* The tile at the left of a named row: the logo on white, or the initials. */
  function logoTile(p) {
    const src = p.logo || logoFor(p.university, p.shortName);
    if (src) return '<div class="flogo img" aria-hidden="true"><img src="' + esc(src) + '" alt="" loading="lazy" decoding="async" width="44" height="44"></div>';
    return '<div class="flogo" aria-hidden="true">' + esc(initials(p.shortName || p.university)) + '</div>';
  }
  /* Round 15 Oct (1): a country as its SVG flag (/flags/<cc>.svg, vendored
     from flag-icons). The emoji flag is two letters on Windows. */
  function flagImg(code, name, w) {
    const cc = String(code || '').toLowerCase();
    if (!/^[a-z]{2}$/.test(cc)) return '';
    w = w || 24;
    return '<img class="flagimg" src="/flags/' + cc + '.svg" alt="' + esc(name || cc.toUpperCase()) + '" width="' + w + '" height="' + Math.round(w * 3 / 4)
      + '" loading="lazy" decoding="async" style="border-radius:4px;box-shadow:0 0 0 1px rgba(16,24,40,.16);object-fit:cover;vertical-align:middle;background:#fff">';
  }
  /* Round 175: the blur on a locked row is a FIXED width. It used to be the
     length of the hidden name, and the length plus the public university
     list was enough to name the university. Two widths, picked by the row's
     stand-in id (a keyed hash that says nothing about the name), so a list
     of locked rows does not look machine-stamped. */
  const filler = n => '█'.repeat(Math.max(6, Math.min(34, Number(n || 18))));
  const pick = (p, a, b) => (/[0-7]$/.test(String(p && p.id || '')) ? a : b);
  const nameBlur = p => filler(pick(p, 22, 26));
  const uniBlur = p => filler(pick(p, 16, 14));
  /* The university's page address — the same arithmetic as unis.js slugOf. */
  const slugOf = name => String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

  const REQ_WORDS = { english: 'English score', gre: 'GRE', greSections: 'GRE sections', germanLevel: 'German level', bachelorYears: 'bachelor’s length', workExpMonths: 'work experience', papers: 'publications', ects: 'ECTS credits', topPercent: 'class rank', cgpa: 'CGPA', germanGrade: 'German grade (your university’s pass mark)' };

  /* One result row. `ctx`: { countries, saved:Set, compared:Set, signedIn } */
  function rowHtml(p, ctx) {
    const C = (ctx && ctx.countries) || {};
    const c = C[p.country] || { name: p.country, flag: '\u{1F30D}' };
    const v = p._v || { fails: [], unknown: [], notes: [] };
    const fee = p._fee || feeOf(p);
    const dl = p._dl || nextDeadline(p);
    const tags = [];
    if (tuitionOf(p) === 0) tags.push('<span class="ft t0">No tuition</span>');
    tags.push(fee === 'free' ? '<span class="ft tfree">Free to apply</span>' : '<span class="ft tpkg">With a package</span>');
    if (reqsOf(p).moiAccepted === true) tags.push('<span class="ft">MOI accepted</span>');
    /* Round 178 (F3/F4): shown, not hidden — with the word on it. */
    const nts = (v && v.notes) || [];
    if (nts.some(n => /^maybe/i.test(n))) tags.push('<span class="ft tmaybe" title="Asks more than 180 ECTS and says nothing about a 3-year degree">Maybe – check eligibility</span>');
    if (nts.some(n => /moi possibly/i.test(n))) tags.push('<span class="ft tmaybe">MOI possibly accepted</span>');
    /* Patch 170: restriction ranks, it is not shown on the public row. */
    /* Round 169 (WEB-02/12): no "Fit %" badge on a public page. The number
       was a stored 80 on every row, not a score of anything the visitor said. */
    let verdictHtml = '';
    if (v.fails && v.fails.length) verdictHtml = '<span class="fv short" title="' + esc(v.fails.map(x => (x.label || x.key) + ': asks ' + x.want + ', you said ' + x.have).join('; ')) + '">Lower priority \u00b7 ' + esc(v.fails.length === 1 ? (v.fails[0].label || v.fails[0].key) + ' asks ' + v.fails[0].want : v.fails.length + ' things it asks') + '</span>';
    else if (v.unknown && v.unknown.length) verdictHtml = '<span class="fv unknown">Chances unknown · tell us your ' + esc(REQ_WORDS[v.unknown[0]] || v.unknown[0]) + '</span>';
    else if (v.notes && v.notes.some(n => n === 'moi' || /clears via moi/i.test(n))) verdictHtml = '<span class="fv ok">✓ Clears via MOI letter</span>';
    else if (ctx && ctx.said && statesAny(p)) verdictHtml = '<span class="fv ok">✓ You clear what it asks</span>';
    const when = dl.at ? 'Closes ' + dateOf(dl.at) : dl.closed ? 'Intake closed' : 'Dates to confirm';
    const saved = ctx && ctx.saved && ctx.saved.has(String(p.id));
    const cmp = ctx && ctx.compared && ctx.compared.has(String(p.id));
    const acts = '<button type="button" class="fi" data-save="' + esc(p.id) + '" aria-pressed="' + (saved ? 'true' : 'false') + '" title="Save to your shortlist">' + (saved ? '♥' : '♡') + '</button>'
      + '<button type="button" class="fi" data-cmp="' + esc(p.id) + '" aria-pressed="' + (cmp ? 'true' : 'false') + '" title="Compare">⇄</button>';
    if (p._locked || locked(p)) {
      return '<article class="frow locked" data-id="' + esc(p.id) + '">'
        + '<div class="flogo lock" aria-hidden="true">' + (flagImg(p.country, c.name, 30) || esc(c.flag)) + '</div>'
        + '<div class="fmain"><h3 class="ftitle masked" aria-hidden="true">' + nameBlur(p) + '</h3>'
        + '<div class="fsub"><span class="masked" aria-hidden="true">' + uniBlur(p) + '</span> · ' + esc(c.name) + ' · Public university</div>'
        + '<span class="offscreen">A public university in ' + esc(c.name) + ' that matches these filters. The name and the fee are unlocked by a package.</span>'
        + '<div class="ftags">' + tags.join('') + '</div>' + verdictHtml + '</div>'
        + '<div class="fside"><div class="fcost masked" aria-hidden="true">████</div><div class="fwhen">' + esc(when) + '</div>'
        + '<div class="facts">' + acts + '<a class="btn btn-navy btn-sm" href="index.html#packages">Unlock</a></div></div></article>';
    }
    const uniSlug = String(p.uniSlug || slugOf(p.university)).trim();
    const uniName = esc(p.shortName || p.university);
    const uniHtml = uniSlug ? '<a href="/university/' + esc(uniSlug) + '">' + uniName + '</a>' : uniName;
    /* A visitor's row has its indicative fee stripped (UNIS.publicFee —
       totalInr 0); a counsellor's keeps it, labelled. */
    const cost = feeIndicative(p) ? (Number(p.totalInr) > 0 ? '<div class="fcost">' + money(p.totalInr) + '<small>total (indicative)</small></div>' : '<div class="fcost unk">Fee on request</div>')
      : feeUnknown(p) ? '<div class="fcost unk">Fee to be confirmed</div>'
      : tuitionOf(p) === 0 ? '<div class="fcost">No tuition<small>semester fee only</small></div>'
      : '<div class="fcost">' + money(p.totalInr) + '<small>total, all years</small></div>';
    return '<article class="frow" data-id="' + esc(p.id) + '">'
      + logoTile(p)
      + '<div class="fmain"><h3 class="ftitle">' + esc(p.program) + '</h3>'
      + '<div class="fsub">' + uniHtml + (p.city ? ' · ' + esc(p.city) : '') + ' · ' + esc(c.name) + (typeLabel(p) ? ' · ' + typeLabel(p) + ' university' : '') + '</div>'
      /* Round 178 (F8): a private campus that awards a foreign degree says whose. */
      + (awardingBody(p) ? '<div class="fsub fawb">Degree awarded by ' + esc(awardingBody(p)) + '</div>' : '')
      + '<div class="ftags">' + tags.join('') + '</div>' + verdictHtml + '</div>'
      + '<div class="fside">' + cost + '<div class="fwhen">' + esc(when) + '</div>'
      + '<div class="facts">' + acts
      + '<a class="btn btn-sm ' + (fee === 'free' ? 'btn-green' : 'btn-gold') + '" href="/university/' + esc(uniSlug) + '#' + esc(slugOf(p.program)) + '">' + (fee === 'free' ? 'Apply free' : 'See details') + '</a></div></div></article>';
  }

  /* Round 177 (item 15): the list is drawn in two parts when the visitor
     has said something about themselves — the rows they clear (or that
     ask nothing they have answered) first, then a divider, then the rows
     short of something they ask (tier 2: a stated IELTS, GRE, ECTS, German
     level… they fall below). The home finder's wording (turnedBox), with
     no number on it: the owner's rule is that nothing on a public page is
     counted. Nothing is hidden — the divider only names the split. */
  const DIVIDER = 'Ranked lower — short of something they ask on what you told us';
  function dividerHtml() {
    return '<div class="fdivide" id="fdivide" role="separator" aria-label="' + DIVIDER + '"><span>' + DIVIDER + '</span></div>';
  }
  const isShort = p => (p._tier || 0) === 2 || !!(p._v && p._v.fails && p._v.fails.length);
  /* The rows as HTML, the divider in its place. `ctx.said` false: no split. */
  function listHtml(rows, ctx) {
    let out = '', split = false;
    (rows || []).forEach(p => {
      if (!split && ctx && ctx.said && isShort(p)) { split = true; out += dividerHtml(); }
      out += rowHtml(p, ctx);
    });
    return out;
  }

  /* Round 178 (owner): "for any selection criteria we do not have any unis
     matching, or any country we do not have relevant universities, we need
     to display a contact form". The same form as a destination page with
     nothing listed (serve.js noListingBlock), posted by the same delegated
     script (NOLIST_JS), landing in the same leads book. */
  function askFormHtml(f) {
    return '<div class="nolist"><p class="nl-lead">We do not list every university publicly — some placements are '
      + 'arranged directly, and a counsellor holds that list. Leave your number and a counsellor will come back to you '
      + 'with what is actually open for your profile.</p>'
      + '<form class="nl-form" id="nlForm" novalidate>'
      + '<input id="nlName" placeholder="Your name" autocomplete="name">'
      + '<input id="nlPhone" placeholder="Mobile" inputmode="tel" autocomplete="tel">'
      + '<input id="nlEmail" placeholder="Email" inputmode="email" autocomplete="email">'
      + '<input class="nl-hp" id="nlWeb" tabindex="-1" autocomplete="off" aria-hidden="true">'
      + '<label class="nl-ok"><input type="checkbox" id="nlOk"><span>I agree that Glovels may contact me about my enquiry. I can ask for my details to be deleted at any time.</span></label>'
      + '<button type="submit" class="btn btn-primary" id="nlGo">Send to a counsellor</button></form>'
      + '<p class="nl-err" id="nlErr" role="alert" hidden></p>'
      + '<input type="hidden" id="nlDest" value="' + esc(String((f && f.country) || '').split(',')[0]) + '"></div>';
  }
  function emptyHtml(f) {
    /* Round 169 (WEB-20.5): when the words typed are what emptied the list,
       say that — CGPA advice is no help to a search that matched nothing. */
    if (has(f.q) || has(f.tags)) {
      return '<div class="fempty"><b>Nothing matches that search — try fewer words.</b> Or remove a tag'
        + ' — or <a href="index.html#counsel">ask a counsellor</a>; we place students at universities this list does not show.</div>'
        + askFormHtml(f);
    }
    return '<div class="fempty"><b>Not seeing what you expected?</b> Widen the CGPA range'
      + (f.tuition === '0' ? ', remove “No tuition”' : '') + (f.apply ? ', show both free and package rows' : '')
      + ' — or <a href="index.html#counsel">ask a counsellor</a> to check your profile against the full list.</div>'
      + askFormHtml(f);
  }

  return { KEYS, LEVELS, SORTS, LOCKED_CAP, capLocked, facetValues, defaultSort, parse, toQuery, student, saidAnything, run, keep, verdict, sortRows, title, chipLabel, rowHtml, emptyHtml, listHtml, dividerHtml, isShort,
    nextDeadline, upcomingTerms, termByKey, locked, feeOf, tuitionOf, feeUnknown, levelKey, feeIndicative, typeLabel, awardingBody, GERMANY_ONLY, germanyOnlyOff, germanFrom, money, esc, num, logoFor, logoTokens, tagList, flagImg };
});
