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
  const KEYS = ['country', 'level', 'field', 'apply', 'tuition', 'intake', 'moi', 'nogre', 'restricted',
    'cgpa', 'english', 'work', 'gre', 'greScore', 'greQuant', 'greVerbal', 'greAwa', 'german',
    'bachelorYears', 'ects', 'topPercent', 'papers', 'q', 'sort', 'view'];

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
    KEYS.forEach(k => { const v = String(get(k) || '').trim(); if (v) f[k] = v.slice(0, 80); });
    const alias = String(get('feeModel') || '').trim();
    if (!f.apply && (alias === 'free' || alias === 'package')) f.apply = alias;
    if (f.apply && f.apply !== 'free' && f.apply !== 'package') delete f.apply;
    if (f.restricted && f.restricted !== 'open' && f.restricted !== 'restricted') delete f.restricted;
    if (f.sort && !SORTS[f.sort]) delete f.sort;
    if (f.view && f.view !== 'list' && f.view !== 'uni') delete f.view;
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
    if (f.gre === 'none') s.gre = false;
    else if (f.gre === 'yes') s.gre = num(f.greScore) != null ? num(f.greScore) : 'taken';
    else if (num(f.gre) != null) s.gre = num(f.gre);
    if (s.gre !== false) {
      if (num(f.greQuant) != null) s.greQuant = num(f.greQuant);
      if (num(f.greVerbal) != null) s.greVerbal = num(f.greVerbal);
      if (num(f.greAwa) != null) s.greAwa = num(f.greAwa);
    }
    if (has(f.german)) s.germanLevel = f.german;
    if (num(f.bachelorYears) != null) s.bachelorYears = num(f.bachelorYears);
    if (num(f.ects) != null) s.ects = num(f.ects);
    else if (s.bachelorYears != null) s.ects = s.bachelorYears >= 4 ? 240 : 180;
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
  const feeOf = p => (p.feeModel === 'free' || p.feeModel === 'package') ? p.feeModel : (p.isPublic ? 'package' : 'free');
  const tuitionOf = p => { const t = reqsOf(p).tuitionEurSem; return (t === null || t === undefined || t === '') ? null : num(t); };
  /* Does the row ask for anything at all? A green chip on a programme that
     states nothing would be a lie — the home page draws the same line. */
  const statesAny = p => num(p.minCgpa) != null || Object.keys(reqsOf(p)).some(k => { const v = reqsOf(p)[k]; return k !== 'tuitionEurSem' && k !== 'specialisation' && v !== null && v !== undefined && v !== '' && v !== false; });
  /* "Fee to be confirmed" where nothing is stated, the way the home page says it. */
  const feeUnknown = p => !locked(p) && !Number(p.totalInr || 0) && tuitionOf(p) == null && !p.freeTuition;

  /* Which rows the narrowing filters keep. `skip` leaves one key out, so a
     facet can count what it would add. */
  function keep(p, f, skip) {
    const on = k => k !== skip && has(f[k]);
    if (on('country') && p.country !== f.country) return false;
    if (on('level') && String(p.level || '').toLowerCase() !== f.level.toLowerCase()) return false;
    if (on('field') && String(p.field || '') !== f.field) return false;
    if (on('apply') && feeOf(p) !== f.apply) return false;
    if (on('tuition')) {
      const cap = num(f.tuition), t = tuitionOf(p);
      if (cap === 0) { if (t !== 0) return false; }
      else if (cap != null && t != null && t > cap) return false;
    }
    if (on('intake')) { const t = termByKey(f.intake); if (t && !openFor(p, t)) return false; }
    if (on('moi') && reqsOf(p).moiAccepted !== true) return false;
    if (on('nogre') && reqsOf(p).greRequired === true) return false;
    if (on('restricted')) {
      const r = reqsOf(p).restricted === true || p.restricted === true;
      if (f.restricted === 'open' && r) return false;
      if (f.restricted === 'restricted' && !r) return false;
    }
    if (on('q')) {
      const hay = (String(p.program || '') + ' ' + String(p.university || '') + ' ' + String(p.city || '') + ' ' + String(p.field || '')).toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }

  /* The verdict on one row against what the visitor said: fails / unknown /
     notes from reqs.check(), plus the CGPA bar the row itself sets. */
  function verdict(p, s, REQS) {
    const r = reqsOf(p);
    const v = REQS ? REQS.check(r, s) : { fails: [], unknown: [], notes: [], ok: true };
    const bar = num(p.minCgpa);
    if (bar != null) {
      if (s.cgpa == null) v.unknown = v.unknown.concat(['cgpa']);
      else if (s.cgpa < bar) v.fails = [{ key: 'cgpa', label: 'CGPA', want: String(bar), have: String(s.cgpa) }].concat(v.fails);
    }
    v.ok = v.fails.length === 0 && v.unknown.length === 0;
    return v;
  }

  /* Patch 161 (D4): with nothing said about themselves a visitor sees no
     fit score, so the list opens on the nearest deadline instead. */
  const defaultSort = said => said ? 'fit' : 'deadline';
  function sortRows(rows, key, said) {
    const k = SORTS[key] ? key : defaultSort(said);
    const az = p => (locked(p) ? '￿' : '') + String(p.program || '').toLowerCase() + ' ' + String(p.university || '').toLowerCase();
    const cost = p => { const t = tuitionOf(p); if (t != null) return t * (p.semesters || 4); const n = Number(p.totalInr || 0); return n > 0 ? n / 90 : (locked(p) ? 1e12 : 1e11); };
    const dl = p => { const d = nextDeadline(p).at; return d ? d.getTime() : 8.64e15; };
    const fit = p => Number(p.fit || 0);
    const cmp = { deadline: (a, b) => dl(a) - dl(b) || fit(b) - fit(a), cost: (a, b) => cost(a) - cost(b) || fit(b) - fit(a),
      fit: (a, b) => fit(b) - fit(a) || dl(a) - dl(b), az: (a, b) => (az(a) < az(b) ? -1 : az(a) > az(b) ? 1 : 0) }[k];
    return rows.slice().sort(cmp);
  }

  /* Everything the page needs for one address: the rows that match, the
     verdict on each, the counts, and the facets. `REQS` is the checker from
     reqs.js; without it the profile answers are shown but not checked. */
  function run(rows, f, REQS) {
    const s = student(f);
    const said = saidAnything(s);
    const kept = rows.filter(p => keep(p, f));
    const out = [];
    let turned = 0;
    kept.forEach(p => {
      const v = said ? verdict(p, s, REQS) : { fails: [], unknown: [], notes: [], ok: false };
      /* Patch 162: a shortfall ranks the row lower; it does not drop it. The
         CGPA bar is the exception — the one requirement that turns a row away. */
      if (said && v.fails.some(x => x.key === 'cgpa')) { turned++; return; }
      out.push(Object.assign({}, p, { _v: v, _tier: v.fails.length ? 2 : v.unknown.length ? 1 : 0, _locked: locked(p), _fee: feeOf(p), _dl: nextDeadline(p) }));
    });
    const sorted = said ? sortRows(out, f.sort, said).sort((a, b) => a._tier - b._tier) : sortRows(out, f.sort, said);
    const unis = new Set(sorted.map(p => p.uKey || p.university || p.id)).size;
    const facet = (key, valueOf) => {
      const c = {};
      rows.forEach(p => { if (!keep(p, f, key)) return; const v = valueOf(p); if (v) c[v] = (c[v] || 0) + 1; });
      return c;
    };
    const facets = {
      country: facet('country', p => p.country),
      level: facet('level', p => String(p.level || '').toLowerCase()),
      field: facet('field', p => p.field),
      apply: facet('apply', p => feeOf(p)),
      tuition0: rows.filter(p => keep(p, f, 'tuition') && tuitionOf(p) === 0).length,
      moi: rows.filter(p => keep(p, f, 'moi') && reqsOf(p).moiAccepted === true).length,
      nogre: rows.filter(p => keep(p, f, 'nogre') && reqsOf(p).greRequired !== true).length,
      open: rows.filter(p => keep(p, f, 'restricted') && !(reqsOf(p).restricted === true || p.restricted === true)).length,
      intake: {},
    };
    upcomingTerms(4).forEach(t => { const n = rows.filter(p => keep(p, f, 'intake') && openFor(p, t)).length; if (n) facets.intake[t.key] = n; });
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
    if (n != null) t += ' — ' + n.toLocaleString('en-IN') + ' programme' + (n === 1 ? '' : 's');
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
      case 'english': return /^ielts:/.test(v) ? 'IELTS ' + v.slice(6) : /^toefl:/.test(v) ? 'TOEFL ' + v.slice(6) : v === 'moi' ? 'English-medium bachelor’s' : v === 'none' ? 'No English test yet' : v;
      case 'work': return v === '0' ? 'No work experience' : v + '+ months’ work';
      case 'gre': return v === 'none' ? 'GRE not taken' : v === 'yes' ? 'GRE taken' : 'GRE ' + v;
      case 'greScore': return 'GRE ' + v;
      case 'greQuant': return 'Quant ' + v;
      case 'greVerbal': return 'Verbal ' + v;
      case 'greAwa': return 'AWA ' + v;
      case 'german': return v === 'none' ? 'No German yet' : 'German ' + v;
      case 'bachelorYears': return v + '-year bachelor’s';
      case 'ects': return v + ' ECTS';
      case 'topPercent': return v === '100' ? 'Below top 50%' : 'Top ' + v + '%';
      case 'papers': return v === 'yes' ? 'Published a paper' : 'No paper published';
      case 'q': return '“' + v + '”';
      default: return null;
    }
  }

  const money = n => { n = Number(n || 0); if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr'; if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1).replace(/\.0$/, '') + ' L'; return '₹' + n.toLocaleString('en-IN'); };
  const dateOf = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const initials = s => String(s || '').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(w => w && !/^(of|the|and|for|in|de|der|die|und)$/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'U';
  const filler = n => '█'.repeat(Math.max(6, Math.min(34, Number(n || 18))));
  /* The university's page address — the same arithmetic as unis.js slugOf. */
  const slugOf = name => String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

  const REQ_WORDS = { english: 'English score', gre: 'GRE', greSections: 'GRE sections', germanLevel: 'German level', bachelorYears: 'bachelor’s length', workExpMonths: 'work experience', papers: 'publications', ects: 'ECTS credits', topPercent: 'class rank', cgpa: 'CGPA' };

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
    if (reqsOf(p).restricted === true || p.restricted === true) tags.push('<span class="ft trest">Restricted admission</span>');
    if (p.fit && ctx && ctx.said) tags.push('<span class="ft tfit">Fit ' + Number(p.fit) + '%</span>');
    let verdictHtml = '';
    if (v.fails && v.fails.length) verdictHtml = '<span class="fv short" title="' + esc(v.fails.map(x => (x.label || x.key) + ': asks ' + x.want + ', you said ' + x.have).join('; ')) + '">Lower priority \u00b7 ' + esc(v.fails.length === 1 ? (v.fails[0].label || v.fails[0].key) + ' asks ' + v.fails[0].want : v.fails.length + ' things it asks') + '</span>';
    else if (v.unknown && v.unknown.length) verdictHtml = '<span class="fv unknown">Chances unknown · tell us your ' + esc(REQ_WORDS[v.unknown[0]] || v.unknown[0]) + '</span>';
    else if (v.notes && v.notes.includes('moi')) verdictHtml = '<span class="fv ok">✓ Clears via MOI letter</span>';
    else if (ctx && ctx.said && statesAny(p)) verdictHtml = '<span class="fv ok">✓ You clear what it asks</span>';
    const when = dl.at ? 'Closes ' + dateOf(dl.at) : dl.closed ? 'Intake closed' : 'Dates to confirm';
    const saved = ctx && ctx.saved && ctx.saved.has(String(p.id));
    const cmp = ctx && ctx.compared && ctx.compared.has(String(p.id));
    const acts = '<button type="button" class="fi" data-save="' + esc(p.id) + '" aria-pressed="' + (saved ? 'true' : 'false') + '" title="Save to your shortlist">' + (saved ? '♥' : '♡') + '</button>'
      + '<button type="button" class="fi" data-cmp="' + esc(p.id) + '" aria-pressed="' + (cmp ? 'true' : 'false') + '" title="Compare">⇄</button>';
    if (p._locked || locked(p)) {
      return '<article class="frow locked" data-id="' + esc(p.id) + '">'
        + '<div class="flogo lock" aria-hidden="true">' + esc(c.flag) + '</div>'
        + '<div class="fmain"><h3 class="ftitle masked" aria-hidden="true">' + filler(p.nLen) + '</h3>'
        + '<div class="fsub"><span class="masked" aria-hidden="true">' + filler(p.uLen) + '</span> · ' + esc(c.name) + ' · Public university</div>'
        + '<span class="offscreen">A public university in ' + esc(c.name) + ' that matches these filters. The name and the fee are unlocked by a package.</span>'
        + '<div class="ftags">' + tags.join('') + '</div>' + verdictHtml + '</div>'
        + '<div class="fside"><div class="fcost masked" aria-hidden="true">████</div><div class="fwhen">' + esc(when) + '</div>'
        + '<div class="facts">' + acts + '<a class="btn btn-navy btn-sm" href="index.html#packages">Unlock</a></div></div></article>';
    }
    const uniSlug = String(p.uniSlug || slugOf(p.university)).trim();
    const uniName = esc(p.shortName || p.university);
    const uniHtml = uniSlug ? '<a href="/university/' + esc(uniSlug) + '">' + uniName + '</a>' : uniName;
    const cost = feeUnknown(p) ? '<div class="fcost unk">Fee to be confirmed</div>'
      : tuitionOf(p) === 0 ? '<div class="fcost">No tuition<small>semester fee only</small></div>'
      : '<div class="fcost">' + money(p.totalInr) + '<small>total, all years</small></div>';
    return '<article class="frow" data-id="' + esc(p.id) + '">'
      + '<div class="flogo" aria-hidden="true">' + esc(initials(p.shortName || p.university)) + '</div>'
      + '<div class="fmain"><h3 class="ftitle">' + esc(p.program) + '</h3>'
      + '<div class="fsub">' + uniHtml + (p.city ? ' · ' + esc(p.city) : '') + ' · ' + esc(c.name) + ' · ' + (p.isPublic ? 'Public' : 'Private') + ' university</div>'
      + '<div class="ftags">' + tags.join('') + '</div>' + verdictHtml + '</div>'
      + '<div class="fside">' + cost + '<div class="fwhen">' + esc(when) + '</div>'
      + '<div class="facts">' + acts
      + '<a class="btn btn-sm ' + (fee === 'free' ? 'btn-green' : 'btn-gold') + '" href="/university/' + esc(uniSlug) + '#' + esc(slugOf(p.program)) + '">' + (fee === 'free' ? 'Apply free' : 'See details') + '</a></div></div></article>';
  }

  function emptyHtml(f) {
    return '<div class="fempty"><b>Not seeing what you expected?</b> Widen the CGPA range'
      + (f.tuition === '0' ? ', remove “No tuition”' : '') + (f.apply ? ', show both free and package rows' : '')
      + ' — or <a href="index.html#counsel">ask a counsellor</a> to check your profile against the full list.</div>';
  }

  return { KEYS, LEVELS, SORTS, defaultSort, parse, toQuery, student, saidAnything, run, keep, verdict, sortRows, title, chipLabel, rowHtml, emptyHtml,
    nextDeadline, upcomingTerms, termByKey, locked, feeOf, tuitionOf, feeUnknown, money, esc, num };
});
