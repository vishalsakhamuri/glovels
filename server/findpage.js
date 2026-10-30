/*
 * /find-university — the page.
 *
 * Patch 159. "The results live only inside a homepage scroll box: no filters
 * beyond the finder, no sort, no compare, no save, no shareable address, no
 * way for Google to index a 'Masters in Data Science in Germany' result."
 *
 * The server renders the whole page for one address — title, filter rail
 * with counts, the first forty rows — so a crawler and a visitor with scripts
 * off see real results. The browser then loads /js/find.js (the same module
 * the server just used) and /js/reqs.js (the same requirement checker), reads
 * /api/catalogue with the visitor's own entitlement, and re-renders on every
 * change, writing the filters back into the address.
 *
 * What the server renders is the SIGNED-OUT view: public universities as
 * locked rows. A visitor who has paid sees their names once the browser has
 * fetched the catalogue as them — the entitlement is decided in
 * /api/catalogue, never here, so this page cannot widen it.
 */
'use strict';

const FIND = require('./find.js');
const REQS = require('./reqs.js');
const LOGOS = require('./logos.js');
const TAGS = require('./tags.js');
const UNIS = require('./unis.js');
const UNISEARCH = require('./unisearch.js');
const HERO = require('./hero.js');

const esc = FIND.esc;

/* The narrowing filters that make a page worth indexing on their own. Anything
   else in the address — a CGPA, a sort, a test score — is one visitor's search. */
const CANON_KEYS = ['country', 'level', 'field'];

const PAGE = 40;

/* Round 169 (WEB-20.6): the home page's Field options, read from the page
   itself so the two lists cannot drift — 41 here and 47 there was two lists. */
const fsMod = require('fs');
const pathMod = require('path');
let heroCache = { mtime: -1, list: [] };
function heroFields() {
  const file = pathMod.join(__dirname, '..', 'index.html');
  try {
    const st = fsMod.statSync(file);
    if (st.mtimeMs === heroCache.mtime) return heroCache.list;
    const html = fsMod.readFileSync(file, 'utf8');
    const m = /<select id="fField">([\s\S]*?)<\/select>/.exec(html);
    const un = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const list = m ? [...m[1].matchAll(/<option value="([^"]+)"/g)].map(x => un(x[1])) : [];
    heroCache = { mtime: st.mtimeMs, list };
    return list;
  } catch (e) { return heroCache.list; }
}

function makeFindPage({ templates, fill, metaHoles, liveCatalogue, liveCountries, absolute, defaultOg, content, slugOf }) {

  /* The rows as a signed-out visitor is allowed to see them — the same
     withholding /api/catalogue does with no package: a public university's
     name, city and website stay behind. The office's "gate" setting is
     honoured the same way. */
  function publicRows() {
    let gate = 'gated';
    try { const f = content && content.get('finder'); if (f && f.gate) gate = f.gate; } catch (e) { /* strictest */ }
    /* Round 178: an indicative (agent-portal) fee never reaches a visitor —
       the named rows below carried totalInr raw (UNIS.publicFee). */
    return liveCatalogue().filter(p => !p.searchOnly && p.level && p.field).map(UNIS.publicFee).map(p => {
      /* A named row carries its logo (server/logos.js); a locked one never
         does — the logo would name the university the row withholds. */
      /* The tags too, the way /api/catalogue sends them (10 Oct): the row's
         own on a named row, and on a locked one everything but the ones
         that would name it — so the server's first page and the browser's
         re-render answer ?tags= the same way. */
      if (!p.isPublic || gate === 'open') return Object.assign({ uniSlug: slugOf(p.university), logo: LOGOS.logoFor(p.university, p.shortName) }, p, { tags: TAGS.tagsOf(p) });
      if (gate === 'names') return Object.assign({ uniSlug: slugOf(p.university), logo: LOGOS.logoFor(p.university, p.shortName) }, p, { totalInr: 0, freeTuition: false, feeHidden: true, tags: TAGS.tagsOf(p) });
      return {
        id: '', country: p.country, level: p.level, field: p.field, band: p.band, isPublic: true, fit: p.fit, tags: TAGS.publicTags(p),
        intakes: p.intakes, feeModel: p.feeModel, totalInr: p.totalInr, freeTuition: (p.totalInr || 0) === 0,
        minCgpa: p.minCgpa, germanGpa: p.germanGpa, reqs: p.reqs, uKey: p.uKey,
        /* Round 175: no nLen / uLen — the blur is a fixed width (find.js). */
      };
    });
  }

  function canonicalQuery(f) {
    const c = {};
    CANON_KEYS.forEach(k => { if (f[k]) c[k] = f[k]; });
    return FIND.toQuery(c);
  }

  /* Round 176: no count beside an option. "Numbers not required" — and the
     numbers on the rail added up to the hidden set. An option is offered
     when any row carries the value; nothing says how many. */
  const opt = (v, label, n, cur) => '<label class="fopt' + (n === 0 ? ' none' : '') + '"><input type="' + (cur.multi ? 'checkbox' : 'radio') + '" name="' + cur.name + '" value="' + esc(v) + '"' + (cur.value === v ? ' checked' : '') + '> <span>' + (cur.flag || '') + esc(label) + '</span></label>';

  /* The rail, rendered once here; the browser keeps the same options. */
  function railHtml(f, R, countries) {
    const g = (title, body, open) => '<details class="fg"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary><div class="fgb">' + body + '</div></details>';
    const cs = Object.keys(R.facets.country).sort((a, b) => String(countries[a] ? countries[a].name : a).localeCompare(String(countries[b] ? countries[b].name : b)));
    const dest = '<label class="fopt"><input type="radio" name="country" value=""' + (!f.country ? ' checked' : '') + '> <span>All destinations</span></label>'
      + cs.map(c => opt(c, (countries[c] ? countries[c].name : c), R.facets.country[c],
        { name: 'country', value: f.country, flag: FIND.flagImg(c, countries[c] ? countries[c].name : c, 20) + ' ' })).join('');
    const lv = Object.keys(R.facets.level).sort();
    const level = '<label class="fopt"><input type="radio" name="level" value=""' + (!f.level ? ' checked' : '') + '> <span>Any level</span></label>'
      + lv.map(l => opt(l, FIND.LEVELS[l] || l, R.facets.level[l], { name: 'level', value: String(f.level || '').toLowerCase() })).join('');
    /* Round 169 (WEB-20.6): the same fields as the home page's Field box, in
       its order — the hero's list is the one source — then any field the
       catalogue holds that the list does not, as the hero adds them. */
    const hero = heroFields();
    const extra = Object.keys(R.facets.field).filter(x => !hero.includes(x)).sort();
    const fs = hero.concat(extra);
    const field = '<label class="fopt"><input type="radio" name="field" value=""' + (!f.field ? ' checked' : '') + '> <span>Any field</span></label>'
      + fs.map(x => opt(x, x.replace(/&amp;/g, '&'), R.facets.field[x] || 0, { name: 'field', value: f.field })).join('');
    /* Round 15 Oct (11): "not told" is its own state — the box below — and
       10 on the slider means 10. Untold, the slider rests faded mid-scale. */
    const cg = '<div class="fcg' + (f.cgpa ? '' : ' empty') + '"><input type="range" id="fcgpa" name="cgpa" min="5" max="10" step="0.1" value="' + esc(f.cgpa || '7.5') + '" aria-label="Your CGPA">'
      + '<output for="fcgpa">' + (f.cgpa ? 'CGPA ' + esc(f.cgpa) : 'Not told us yet') + '</output>'
      + '<label class="fcgnone"><input type="checkbox" id="fcgnone"' + (f.cgpa ? '' : ' checked') + '> Not told us yet</label>'
      + (f.cgpa ? '<button type="button" class="flink" data-clear="cgpa">clear</button>' : '') + '</div>';
    const tu = [['', 'Any tuition', null], ['0', 'No tuition fee', R.facets.tuition0], ['500', 'Up to €500 / semester', null], ['1500', 'Up to €1,500', null], ['4000', 'Up to €4,000', null], ['6000', 'Up to €6,000', null]]
      .map(([v, l, n]) => '<label class="fopt' + (n === 0 ? ' none' : '') + '"><input type="radio" name="tuition" value="' + v + '"' + ((f.tuition || '') === v ? ' checked' : '') + '> <span>' + l + '</span></label>').join('');
    const terms = FIND.upcomingTerms(4).filter(t => R.facets.intake[t.key]);
    const it = '<label class="fopt"><input type="radio" name="intake" value=""' + (!f.intake ? ' checked' : '') + '> <span>Any intake</span></label>'
      + terms.map(t => opt(t.key, t.season.charAt(0).toUpperCase() + t.season.slice(1) + ' ' + t.year, R.facets.intake[t.key], { name: 'intake', value: f.intake })).join('');
    const ap = '<label class="fopt"><input type="radio" name="apply" value=""' + (!f.apply ? ' checked' : '') + '> <span>Either</span></label>'
      + opt('free', 'Free to apply', R.facets.apply.free, { name: 'apply', value: f.apply })
      + opt('package', 'With a package', R.facets.apply.package, { name: 'apply', value: f.apply });
    const te = '<label class="fopt"><input type="checkbox" name="moi" value="1"' + (f.moi ? ' checked' : '') + '> <span>MOI letter accepted</span></label>'
      + '<label class="fopt"><input type="checkbox" name="nogre" value="1"' + (f.nogre ? ' checked' : '') + '> <span>No GRE needed</span></label>'
      /* Round 178 (F7.4): Germany-only — hidden for another destination. */
      + '<label class="fopt" data-germany-only="1"' + (FIND.germanyOnlyOff(f) ? ' hidden' : '') + '><input type="checkbox" name="restricted" value="open"' + (f.restricted === 'open' ? ' checked' : '') + '> <span>Open admission only</span></label>';
    return g('Destination', dest, true) + g('Level', level, true) + g('Field', field, !!f.field) + g('Your CGPA', cg, !!f.cgpa)
      + g('Tuition', tu, !!f.tuition) + g('Intake', it, !!f.intake) + g('Applying', ap, !!f.apply) + g('Tests & admission', te, !!(f.moi || f.nogre || f.restricted))
      + '<details class="fg" id="ftagsGroup" open' + (FIND.tagList(f.tags).length ? '' : ' hidden') + '><summary>Tags</summary><div class="fgb" id="ftagsRail">' + tagsRailHtml(f) + '</div></details>';
  }
  /* 10 Oct: the chosen tags in the rail, each with its ×. */
  function tagsRailHtml(f) {
    const list = FIND.tagList(f.tags);
    return list.length ? list.map(t => '<button type="button" class="ftagrow" data-cleartag="' + esc(t) + '"><span>' + esc(t) + '</span><b aria-hidden="true">×</b><span class="offscreen"> remove</span></button>').join('')
      : '<div class="fmore-note">Type in the search box and pick a tag.</div>';
  }

  function chipsHtml(f, countries) {
    const chips = [];
    FIND.KEYS.forEach(k => {
      if (!f[k] || k === 'sort' || k === 'view') return;
      /* 10 Oct: one chip per chosen tag, each with its own ×. */
      if (k === 'tags') {
        FIND.tagList(f.tags).forEach(t => chips.push('<button type="button" class="fchip ftagchip" data-cleartag="' + esc(t) + '">' + esc(t) + ' <b aria-hidden="true">×</b><span class="offscreen"> remove</span></button>'));
        return;
      }
      const l = FIND.chipLabel(k, f[k], countries);
      if (l) chips.push('<button type="button" class="fchip" data-clear="' + esc(k) + '">' + esc(l) + ' <b aria-hidden="true">×</b><span class="offscreen"> remove</span></button>');
    });
    return chips.length ? chips.join('') + '<button type="button" class="flink" data-clear="*">Clear all</button>' : '';
  }

  /* Round 178 (owner): the public side HIDES what the visitor falls short of. */
  const PROF_HIDDEN = 'Programmes that ask for more than you told us — a grade, an English score, ECTS credits, the GRE — are not shown.';
  function profileStrip(R) {
    if (R.said) {
      const parts = Object.keys(R.student).filter(k => k !== 'restrictedOk').length;
      /* Round 176: no count of the rows turned away — a count of the
         hidden set is what it would be. */
      return '<div class="fprof said"><b>Checked against what you told us</b> — ' + parts + ' detail' + (parts === 1 ? '' : 's') + '. '
        + (R.turned ? PROF_HIDDEN + ' ' : '')
        + '<a href="index.html#find">Change your answers →</a></div>';
    }
    return '<div class="fprof"><b>Tell us your scores to see which of these would take you.</b> Your CGPA, IELTS and bachelor’s length are enough to start — '
      + '<a href="index.html#find">add them on the finder →</a> or <a href="login.html?signup=1">create a free account</a> and we keep them.</div>';
  }

  /* Round 176: the line under the list when locked rows were left out —
     that there are more, never how many. Shared with the browser (FIND_PAGE_JS
     draws the same words). */
  const MORE_LOCKED = '<div class="fmore-locked" id="fmoreLocked">More public universities match — <a href="index.html#packages">a package opens them</a>.</div>';
  /* Round 176: the summary names the list; it never counts it. */
  const SUMMARY = { some: 'Programmes that match your filters', none: 'Nothing matches every filter — loosen one' };

  function bodyHtml(f, R, countries, moreLocked) {
    /* Round 176: at most LOCKED_CAP locked rows on the page, and no
       "N programmes at M universities" anywhere on it. */
    const capped = FIND.capLocked(R.rows, FIND.LOCKED_CAP);
    capped.more = capped.more || !!moreLocked;
    const rows = capped.rows.slice(0, PAGE);
    const ctx = { countries, said: R.said };
    /* Round 177 (item 15): the rows they clear, a divider, the rows short
       of something they ask — FIND.listHtml; no count on either part. */
    const list = rows.length ? FIND.listHtml(rows, ctx) : FIND.emptyHtml(f);
    const sort = '<label class="fsort">Sort <select id="fsort">' + Object.keys(FIND.SORTS).map(k => '<option value="' + k + '"' + ((f.sort || FIND.defaultSort(R.said)) === k ? ' selected' : '') + '>' + FIND.SORTS[k] + '</option>').join('') + '</select></label>';
    const view = '<div class="fview" role="group" aria-label="View"><button type="button" data-view="list" aria-pressed="' + (f.view !== 'uni') + '">List</button><button type="button" data-view="uni" aria-pressed="' + (f.view === 'uni') + '">By university</button></div>';
    return '<form id="ffilters" class="ffilters" action="/find-university" method="get">'
      + '<div class="fsearch" id="fsearchWrap"><input type="search" name="q" id="fq" value="' + esc(f.q || '') + '" placeholder="Programme, university, city — or a tag: No German Required, MOI Accepted, TU Munich" aria-label="Search programmes or tags" autocomplete="off" aria-autocomplete="list" aria-controls="fsug" aria-expanded="false"><button type="submit" class="btn btn-green btn-sm">Search</button>'
      + '<div class="fsug" id="fsug" role="listbox" hidden></div></div>'
      + '<div class="fchips" id="fchips">' + chipsHtml(f, countries) + '</div>'
      + '<div class="flayout"><button type="button" class="btn btn-sm fsheet-btn" id="fsheetBtn" aria-controls="frail" aria-expanded="false">Filters<span id="fcount"></span></button>'
      + '<aside class="frail" id="frail"><div class="frail-head"><b>Filters</b><button type="button" class="flink" id="fsheetClose">Done</button></div>' + railHtml(f, R, countries) + '</aside>'
      + '<div class="fresults">'
      + '<div class="fhead"><h2 id="fsummary">' + (rows.length ? SUMMARY.some : SUMMARY.none) + '</h2>'
      + '<div class="ftools">' + sort + view + '<button type="button" class="btn btn-sm" id="fshare">Share this search</button></div></div>'
      + profileStrip(R)
      + '<div id="flist" class="flist">' + list + '</div>'
      + (capped.more ? MORE_LOCKED : '')
      + (capped.rows.length > PAGE ? '<div class="fpage"><button type="button" class="btn btn-sm" id="fmore">Show more</button></div>' : '')
      + '</div></div></form>'
      + '<div class="fcmp" id="fcmp" hidden><span id="fcmpText">Pick programmes to compare</span><button type="button" class="btn btn-green btn-sm" id="fcmpGo">Compare side by side →</button><button type="button" class="flink" id="fcmpClear">Clear</button></div>'
      + '<div class="fmodal" id="fmodal" hidden><div class="fmodal-in" role="dialog" aria-modal="true" aria-labelledby="fmodalH"><div class="fmodal-head"><h2 id="fmodalH">Side by side</h2><button type="button" class="flink" id="fmodalClose">Close</button></div><div id="fmodalBody"></div></div></div>';
  }

  function render(query) {
    const t = templates();
    if (!t) return null;
    const f = FIND.parse(query || '');
    const countries = liveCountries();
    const rows = publicRows();
    /* Round 169: the destinations' CGPA bars, and the universities the search
       box names (WEB-06) — a locked row has no name to match the words on. */
    /* Round 175: only among the universities this (signed-out) page NAMES —
       a locked row stays out of a search for its university's name, the
       same as /api/find/unis answers a signed-out browser. */
    const namedKeys = new Set(rows.filter(r => r.university).map(r => String(r.uKey)));
    const uniKeys = f.q ? UNISEARCH.match(liveCatalogue().filter(p => !p.searchOnly && namedKeys.has(String(p.uKey))), f.q) : null;
    /* Round 176: the locked rows that fit are capped (find.js capLocked)
       and the list is run AGAIN on the named rows plus the kept dozen, so
       the 70/30 mix and the ranking are made of what the page will draw. */
    rows.forEach((p, i) => { p._ix = i; });
    let R = FIND.run(rows, f, REQS, { countries, uniKeys });
    const capped = FIND.capLocked(R.rows, FIND.LOCKED_CAP);
    let more = capped.more;
    if (more) {
      const kept = new Set(capped.rows.filter(p => p._locked).map(p => p._ix));
      R = FIND.run(rows.filter(p => !FIND.locked(p) || kept.has(p._ix)), f, REQS, { countries, uniKeys });
    }
    const name = FIND.title(f, countries, null);
    const title = FIND.title(f, countries, R.total);
    const indexable = Object.keys(f).every(k => CANON_KEYS.includes(k)) && R.total > 0;
    const canonical = absolute('/find-university' + canonicalQuery(f));
    /* Round 176: no count in the description either — it is the page's
       text to a crawler and to a visitor, and the number was the hidden set. */
    const desc = name + (f.country && countries[f.country] && !/ in /.test(name) ? ' in ' + countries[f.country].name : '')
      + ' — what each programme costs in total, when to apply, the CGPA and English score it asks for, and which ones you can apply to free through Glovels.';
    const page = fill(t.page, Object.assign(metaHoles({
      title, desc, canonical, keywords: 'find university, ' + name.toLowerCase() + ', fees, intakes, CGPA, Indian students',
      image: defaultOg, imageAlt: 'Glovels — find your university', type: 'website', indexable,
      jsonld: { '@context': 'https://schema.org', '@type': 'SearchResultsPage', name: title, url: canonical },
    }), {
      H1: name,
      /* Round 15 Oct (6): the banner's eyebrow and chips. Owner rule: no
         programme or university counts in it — how many countries is fine. */
      HERO: HERO.attrs({ eyebrow: 'Find university', chips: [
        [(() => { const n = new Set(rows.map(p => p.country)).size; return n + ' countr' + (n === 1 ? 'y' : 'ies'); })(), 'to choose from'],
        ['Public', 'and private universities'],
        ['Free', 'to apply at affiliated universities'],
      ] }),
      DATELINE: 'Every programme we track, filtered to what fits you. Change a filter and the address changes with it — bookmark it, share it, come back to it.',
      CRUMBS: '<a href="index.html">Home</a> / Find University',
      BODY: bodyHtml(f, R, countries, more),
    }));
    /* The logo index too, so the rows the browser fetches as a signed-in
       visitor — named, but not by this render — get their logos from the
       same matcher (find.js logoFor). */
    const boot = '<script>window.FIND_BOOT=' + JSON.stringify({ f, countries, page: PAGE }).replace(/</g, '\\u003c') + ';'
      + 'window.FIND_LOGOS=' + JSON.stringify(LOGOS.index()).replace(/</g, '\\u003c') + '</script>'
      + '<script src="/js/tags.js" defer></script><script src="/js/find.js" defer></script><script src="/js/reqs.js" defer></script><script src="/js/find-page.js" defer></script>';
    return { html: page.replace('</head>', FIND_CSS + '</head>').replace('</body>', boot + '</body>'), indexable };
  }

  return { render, publicRows };
}

const FIND_CSS = `<style>/* GLOVELS-FIND-CSS */
#page.prose{max-width:var(--maxw)}
.ffilters{display:block}
.fsearch{display:flex;gap:8px;margin:0 0 12px}
.fsearch input{flex:1;min-width:0;padding:10px 14px;border:1px solid var(--line);border-radius:10px;font:400 14.5px/1.3 var(--sans);background:var(--paper)}
.fsearch{position:relative}
.fsug{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:60;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(11,30,49,.18);max-height:380px;overflow-y:auto;padding:6px}
.fsug h5{margin:8px 12px 4px;font:700 10.8px/1.3 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.fsug button{display:flex;width:100%;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;border:0;border-radius:9px;background:none;text-align:left;font:600 13.4px/1.35 var(--sans);color:var(--navy-900);cursor:pointer}
.fsug button:hover,.fsug button[aria-selected="true"]{background:#f0f5fb;outline:none}
.fsug button em{font:400 11.6px/1.3 var(--sans);color:var(--muted);white-space:nowrap}
.fsug .none{padding:12px;font:400 13px/1.5 var(--sans);color:var(--muted)}
.ftagchip{background:#eef3fc;border-color:#b9cdf0;color:#0b3d91}
.ftagrow{display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border:0;background:none;font:600 13px/1.35 var(--sans);color:#0b3d91;cursor:pointer;text-align:left}
.ftagrow b{color:var(--muted);font-weight:700}
.fchips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 14px;min-height:4px}
.fchip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;border:1px solid #bfe0cc;background:#eaf6ee;color:#14603a;font:600 12.5px/1.3 var(--sans);cursor:pointer}
.fchip b{font-weight:700;opacity:.7}
.flink{background:none;border:0;padding:0;color:var(--green);font:600 12.5px/1.3 var(--sans);cursor:pointer;text-decoration:underline}
.flayout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:24px;align-items:start}
.frail{position:sticky;top:90px;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:6px 14px 10px;max-height:calc(100vh - 110px);overflow:auto}
.frail-head{display:none}
.fg{border-bottom:1px solid var(--line);padding:8px 0}
.fg:last-child{border-bottom:0}
.fg summary{cursor:pointer;font:700 13px/1.3 var(--sans);letter-spacing:.04em;text-transform:uppercase;color:var(--navy-800);padding:6px 0;list-style:none;display:flex;justify-content:space-between}
.fg summary::after{content:"+";color:var(--muted)}
.fg[open] summary::after{content:"\\2212"}
.fgb{padding:2px 0 6px}
.fopt{display:flex;align-items:center;gap:8px;padding:4px 0;font:400 13.6px/1.35 var(--sans);cursor:pointer}
.fopt span{flex:1}
.fopt em{font-style:normal;color:var(--muted);font-size:12px}
.fopt.none{opacity:.45}
.fcg{display:flex;flex-direction:column;gap:6px}
.fcg input{width:100%}
.fcg output{font:600 13px/1.3 var(--sans);color:var(--navy-800)}
.fcg.empty input[type=range]{opacity:.45}
.fcg.empty output{color:var(--muted)}
.fcgnone{display:flex;align-items:center;gap:8px;font:400 13.2px/1.35 var(--sans);cursor:pointer}
.fmore-note{font:400 12px/1.4 var(--sans);color:var(--muted);padding:4px 0}
.fsheet-btn{display:none}
.fhead{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin:0 0 10px}
.fhead h2{margin:0;font:700 clamp(17px,2vw,21px)/1.25 var(--sans);color:var(--navy-900)}
.ftools{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.fsort{font:600 13px/1.3 var(--sans);color:var(--muted)}
.fsort select{margin-left:4px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font:600 13px/1.3 var(--sans);background:var(--paper)}
.fview{display:inline-flex;border:1px solid var(--line);border-radius:99px;overflow:hidden}
.fview button{border:0;background:var(--paper);padding:7px 12px;font:600 12.5px/1.3 var(--sans);cursor:pointer;color:var(--muted)}
.fview button[aria-pressed="true"]{background:var(--navy-800);color:#fff}
.fprof{margin:0 0 14px;padding:11px 14px;border-radius:12px;background:#fdf6e6;border:1px solid #e6d5a8;font:400 13.6px/1.55 var(--sans);color:#5b4409}
.fprof.said{background:#eaf6ee;border-color:#bfe0cc;color:#14603a}
.fprof a{font-weight:700;color:inherit}
.flist{display:flex;flex-direction:column;gap:10px}
.frow{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:14px;align-items:start;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.frow.locked{background:#fbfaf6}
.flogo{width:52px;height:52px;border-radius:12px;display:grid;place-items:center;background:var(--navy-800);color:#fff;font:700 17px/1 var(--sans);letter-spacing:.02em}
.flogo.lock{background:#e9e4d6;font-size:24px}
.flogo.img{background:#fff;border:1px solid var(--line);padding:4px;box-sizing:border-box}
.flogo.img img{display:block;width:100%;height:100%;object-fit:contain}
.ftitle{margin:0;font:700 17px/1.3 var(--sans);color:var(--navy-900)}
.fsub{margin:3px 0 0;font:400 13.4px/1.45 var(--sans);color:var(--muted)}
.fsub a{color:var(--navy-700);font-weight:600}
.ftags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.ft{display:inline-block;padding:3px 9px;border-radius:99px;border:1px solid var(--line);background:var(--cream);font:600 11.4px/1.3 var(--sans);color:var(--muted)}
.ft.t0{color:#14603a;border-color:#bfe0cc;background:#eaf6ee}
.ft.tfree{color:#0b3d91;border-color:#b9cdf0;background:#eef3fc}
.ft.tpkg{color:#5b4409;border-color:#e6d5a8;background:#fdf6e6}
.ft.trest{color:#7a3f2b;border-color:#ebc9bd;background:#fbefea}
.fv{display:inline-block;margin:8px 0 0;font:600 12.4px/1.3 var(--sans);color:#14603a}
.fv.unknown{color:#8a6a1f}
.fv.short{color:#8a6a1f;background:#fdf6e6;border:1px solid #e6d5a8;border-radius:99px;padding:2px 9px}
.fside{text-align:right;min-width:150px}
.fcost{font:700 20px/1.1 var(--serif,Georgia,serif);color:var(--green)}
.fcost small{display:block;font:400 11.4px/1.3 var(--sans);color:var(--muted);margin-top:2px}
.fcost.unk{font:600 13.5px/1.3 var(--sans);color:var(--muted)}
.fwhen{margin:6px 0 0;font:400 12.2px/1.3 var(--sans);color:var(--muted)}
.facts{display:flex;justify-content:flex-end;align-items:center;gap:6px;margin:10px 0 0}
.fi{width:34px;height:34px;border-radius:99px;border:1px solid var(--line);background:var(--paper);font-size:16px;cursor:pointer;color:var(--navy-800)}
.fi[aria-pressed="true"]{background:var(--navy-800);color:#fff;border-color:var(--navy-800)}
.masked{filter:blur(5px);user-select:none;color:#9aa6b3;display:inline-block;max-width:100%;overflow:hidden;white-space:nowrap;vertical-align:bottom}
.fmain{min-width:0}
.frow{overflow:hidden}
.offscreen{position:absolute;left:-9999px}
.fempty{padding:22px;border:2px dashed var(--line);border-radius:14px;background:var(--paper);font:400 14px/1.6 var(--sans);color:var(--muted)}
.fempty b{display:block;color:var(--navy-900);margin-bottom:4px}
.fpage{display:flex;align-items:center;gap:14px;margin:16px 0 0;font:400 13px/1.3 var(--sans);color:var(--muted)}
.fmore-locked{margin:12px 0 0;padding:11px 14px;border-radius:12px;background:#fdf6e6;border:1px solid #e6d5a8;font:600 13.4px/1.5 var(--sans);color:#5b4409}
.fmore-locked a{color:inherit}
.funi{margin:0 0 6px;font:700 15px/1.3 var(--sans);color:var(--navy-900);padding:10px 0 0}
/* Round 177 (item 15): the split between the rows they clear and the rows
   short of something they ask. Words, no number. */
.fdivide{display:flex;align-items:center;gap:12px;margin:18px 0 10px;font:700 12.6px/1.3 var(--sans);letter-spacing:.04em;text-transform:uppercase;color:#8a6a1f}
.fdivide::before,.fdivide::after{content:"";flex:1;height:1px;background:#e6d5a8}
/* Round 177 (item 1): the compare bar is above the WhatsApp button, not
   under it — at 618px the fixed button sat on "Clear" and "Compare side by
   side". The bar is z-indexed over the button and the page lifts the
   button clear of it while the bar shows (body.fcmp-open). */
.fcmp{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;padding:12px 18px;background:var(--navy-900);color:#fff;font:600 14px/1.3 var(--sans);box-shadow:0 -8px 30px rgba(0,0,0,.25)}
body.fcmp-open .gv-corner{bottom:calc(var(--fcmp-h,64px) + 14px)!important}
.fcmp .flink{color:#c8d6e4}
.fsharebox{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#f6f9fc;font:600 13px/1.3 var(--sans);color:var(--navy-800)}
.fsharebox input{flex:1;min-width:200px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:400 13px/1.3 var(--sans)}
.fmodal{position:fixed;inset:0;z-index:50;background:rgba(11,30,49,.6);display:grid;place-items:center;padding:16px}
.fmodal-in{background:var(--paper);border-radius:16px;max-width:1000px;width:100%;max-height:90vh;overflow:auto;padding:18px 20px}
.fmodal-head{display:flex;justify-content:space-between;align-items:center;margin:0 0 12px}
.fmodal-head h2{margin:0;font:700 19px/1.3 var(--sans)}
.fcmpt{width:100%;border-collapse:collapse;font:400 13.4px/1.45 var(--sans)}
.fcmpt th,.fcmpt td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.fcmpt th{font-weight:700;color:var(--navy-800);background:var(--cream)}
.fcmpt td:first-child{color:var(--muted);white-space:nowrap}
@media (max-width:900px){
  .flayout{grid-template-columns:1fr}
  .fsheet-btn{display:inline-flex;margin:0 0 10px}
  .frail{display:none;position:fixed;inset:0;z-index:45;border-radius:0;max-height:none;top:0;padding:14px 18px 40px}
  .frail.open{display:block}
  .frail-head{display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;font:700 16px/1.3 var(--sans)}
  .frow{grid-template-columns:44px minmax(0,1fr)}
  .flogo{width:44px;height:44px;font-size:15px}
  .fside{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;text-align:left;min-width:0}
  .fcost{font-size:17px}
  .fwhen{margin:0}
  .facts{margin:0;margin-left:auto}
}
</style>`;

/* The browser side, served at /js/find-page.js. Plain script, no build. */
const FIND_PAGE_JS = String.raw`(function(){
'use strict';
var $ = function(s, r){ return (r || document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var BOOT = window.FIND_BOOT || { f: {}, countries: {}, page: 40 };
var F = window.FIND, R = window.REQS;
var countries = BOOT.countries || {};
var f = BOOT.f || {};
var rows = null, result = null, shown = BOOT.page || 40, me = null;
var saved = new Set(), compared = new Set();
/* Round 176: the locked rows come from the server PER FILTER, capped
   (/api/find/locked) — the page never holds the whole hidden set. named
   is what /api/catalogue named for this viewer; lockedPool the
   placeholders for the filter in lockedFor; lockedMore whether the cap
   was hit. */
var named = null, lockedPool = [], lockedFor = null, lockedAsking = null, lockedMore = false;
var LOCKED_CAP = (F && F.LOCKED_CAP) || 12;
var SUMMARY = { some: 'Programmes that match your filters', none: 'Nothing matches every filter — loosen one' };
var MORE_LOCKED = 'More public universities match — <a href="index.html#packages">a package opens them</a>.';
function lockedKey(){ var g = {}; Object.keys(f).forEach(function(k){ if (k !== 'sort' && k !== 'view') g[k] = f[k]; }); return F.toQuery(g); }
function askLocked(key){
  if (lockedAsking === key) return;
  lockedAsking = key;
  fetch('/api/find/locked' + key, { credentials: 'same-origin' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    if (lockedAsking !== key) return;
    lockedAsking = null; lockedFor = key; lockedPool = (d && d.locked) || []; lockedMore = !!(d && d.more);
    rows = (named || []).concat(lockedPool);
    if (lockedKey() === key) render();
  }).catch(function(){ if (lockedAsking === key) { lockedAsking = null; lockedFor = key; lockedPool = []; lockedMore = false; rows = (named || []).slice(); render(); } });
}
/* Round 169 (WEB-06): the universities the search box names, from the server. */
var uniKeys = null, uniFor = null, uniAsking = null;
function askUnis(q){
  if (uniAsking === q) return;
  uniAsking = q;
  fetch('/api/find/unis?q=' + encodeURIComponent(q), { credentials: 'same-origin' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    if (uniAsking !== q) return;
    uniAsking = null; uniFor = q; uniKeys = (d && d.keys) || [];
    if ((f.q || '') === q) render();
  }).catch(function(){ uniAsking = null; uniFor = q; uniKeys = []; if ((f.q || '') === q) render(); });
}
try { (JSON.parse(localStorage.getItem('glv-saved') || '[]') || []).forEach(function(id){ saved.add(String(id)); }); } catch (e) {}

function url(){ return '/find-university' + F.toQuery(f); }
function write(){ try { history.replaceState(null, '', url()); } catch (e) {} }
function esc(s){ return F.esc(s); }

function ctx(){ return { countries: countries, said: result && result.said, saved: saved, compared: compared }; }

function render(){
  if (!rows) return;
  /* A search waits for the server's answer on which universities it names,
     rather than drawing a list without them and then redrawing it. */
  if (f.q && uniFor !== f.q) { askUnis(f.q); if (result || document.querySelector('#flist .frow')) return; }
  /* Round 176: the locked rows for THIS filter come from the server; until
     they arrive the list is drawn from what is here (the named rows, and
     the last filter's placeholders, which F.run narrows anyway). */
  var lk = lockedKey();
  if (lockedFor !== lk) askLocked(lk);
  result = F.run(rows, f, R, { countries: countries, uniKeys: uniFor === (f.q || '') ? uniKeys : null });
  var capped = F.capLocked(result.rows, LOCKED_CAP);
  var list = $('#flist'), out = '';
  var slice = capped.rows.slice(0, shown);
  if (!slice.length) out = F.emptyHtml(f);
  else if (f.view === 'uni') {
    /* The named universities each under their name; every locked row under
       ONE heading — grouping them by university would count them. */
    var by = {}, order = [];
    slice.forEach(function(p){ var k = p._locked ? '\u0000locked' : (p.uKey || p.university || p.id); if (!by[k]) { by[k] = []; order.push(k); } by[k].push(p); });
    out = order.map(function(k){ var g = by[k]; var name = g[0]._locked ? 'Public universities — unlocked with a package' : (g[0].shortName || g[0].university);
      return '<h3 class="funi">' + esc(name) + '</h3>' + F.listHtml(g, ctx()); }).join('');
    /* Round 177 (item 15): one divider on the page — the first group that
       holds a short row carries it; later groups draw theirs out. */
    var firstDiv = out.indexOf('<div class="fdivide"');
    if (firstDiv >= 0) out = out.slice(0, firstDiv + 1) + out.slice(firstDiv + 1).replace(/<div class="fdivide"[^>]*>.*?<\/div>/g, '');
  } else out = F.listHtml(slice, ctx());
  list.innerHTML = out;
  $('#fsummary').textContent = slice.length ? SUMMARY.some : SUMMARY.none;
  var ml = $('#fmoreLocked'), wantMore = (capped.more || (lockedMore && lockedFor === lk)) && slice.length;
  if (wantMore) { if (!ml) { ml = document.createElement('div'); ml.className = 'fmore-locked'; ml.id = 'fmoreLocked'; list.after(ml); } ml.innerHTML = MORE_LOCKED; }
  else if (ml) ml.remove();
  var pg = $('.fpage');
  if (capped.rows.length > shown) {
    if (!pg) { pg = document.createElement('div'); pg.className = 'fpage'; ($('#fmoreLocked') || list).after(pg); }
    pg.innerHTML = '<button type="button" class="btn btn-sm" id="fmore">Show more</button>';
  } else if (pg) pg.remove();
  chips(); counts(); profile(); cmpBar();
  document.title = F.title(f, countries, result.total) + ' | Glovels';
  var h1 = $('.page-hero h1'); if (h1) { var ht = F.title(f, countries, null); if (window.GLV_HERO_H1) h1.innerHTML = window.GLV_HERO_H1(ht); else h1.textContent = ht; }
  write();
}

function chips(){
  var out = '';
  F.KEYS.forEach(function(k){
    if (!f[k] || k === 'sort' || k === 'view') return;
    if (k === 'tags') { F.tagList(f.tags).forEach(function(t){ out += '<button type="button" class="fchip ftagchip" data-cleartag="' + esc(t) + '">' + esc(t) + ' <b aria-hidden="true">×</b></button>'; }); return; }
    var l = F.chipLabel(k, f[k], countries); if (l) out += '<button type="button" class="fchip" data-clear="' + esc(k) + '">' + esc(l) + ' <b aria-hidden="true">×</b></button>'; });
  if (out) out += '<button type="button" class="flink" data-clear="*">Clear all</button>';
  $('#fchips').innerHTML = out;
  /* The rail's Tags group mirrors the chips. */
  var tl = F.tagList(f.tags), rail = $('#ftagsRail'), grp = $('#ftagsGroup');
  if (rail) rail.innerHTML = tl.length ? tl.map(function(t){ return '<button type="button" class="ftagrow" data-cleartag="' + esc(t) + '"><span>' + esc(t) + '</span><b aria-hidden="true">×</b></button>'; }).join('') : '<div class="fmore-note">Type in the search box and pick a tag.</div>';
  if (grp) grp.hidden = !tl.length;
  var qb = $('#fq'); if (qb && document.activeElement !== qb) qb.value = f.q || '';
  var n = Object.keys(f).filter(function(k){ return k !== 'sort' && k !== 'view'; }).length;
  $('#fcount').textContent = n ? ' (' + n + ')' : '';
}

/* Round 176: the rail carries no counts. The options are the server's
   (every value the whole catalogue holds, locked rows included — the
   facets lists on /api/catalogue), so nothing is dimmed or numbered from
   the capped rows the page holds. */
function counts(){
  $$('#frail .fopt').forEach(function(l){ var em = l.querySelector('em'); if (em) em.remove(); l.classList.remove('none'); });
  /* The boxes mirror the address, so a chip removed un-ticks its box. */
  $$('#frail input[type=radio]').forEach(function(i){ i.checked = (f[i.name] || '') === i.value; });
  $$('#frail input[type=checkbox]').forEach(function(i){ i.checked = !!f[i.name]; });
  var cg = $('#fcgpa'); if (cg) { cg.value = f.cgpa || '7.5'; var o = cg.nextElementSibling; if (o) o.textContent = f.cgpa ? 'CGPA ' + f.cgpa : 'Not told us yet'; if (cg.parentNode) cg.parentNode.classList.toggle('empty', !f.cgpa); }
  var cgn = $('#fcgnone'); if (cgn) cgn.checked = !f.cgpa;
  /* Round 178 (F7.4): the Germany-only boxes follow the destination. */
  $$('#frail [data-germany-only]').forEach(function(l){ l.hidden = F.germanyOnlyOff(f); });
  var s = $('#fsort'); if (s) s.value = f.sort || F.defaultSort(result.said);
  $$('.fview button').forEach(function(b){ b.setAttribute('aria-pressed', String((f.view || 'list') === b.dataset.view)); });
}

function profile(){
  var el = $('.fprof'); if (!el) return;
  if (result.said) {
    var parts = Object.keys(result.student).filter(function(k){ return k !== 'restrictedOk'; }).length;
    el.className = 'fprof said';
    el.innerHTML = '<b>Checked against what you told us</b> — ' + parts + ' detail' + (parts === 1 ? '' : 's') + '. '
      + (result.turned ? 'Programmes that ask for more than you told us — a grade, an English score, ECTS credits, the GRE — are not shown. ' : '')
      + '<a href="index.html#find">Change your answers →</a>';
  } else if (me) {
    el.className = 'fprof';
    el.innerHTML = '<b>Signed in as ' + esc(me.name || me.email || 'you') + '.</b> Your saved profile is read on the home-page finder and your dashboard; here, set your CGPA in the rail or <a href="index.html#find">carry your answers over →</a>';
  }
}

/* Save: the dashboard shortlist when signed in (private rows only — a public
   university is the counsellor's to add), a local list otherwise. */
function save(id, btn){
  var p = rows.find(function(r){ return String(r.id) === String(id); });
  if (!p) return;
  if (saved.has(String(id))) { saved.delete(String(id)); persistSaved(); btn.setAttribute('aria-pressed', 'false'); btn.textContent = '♡'; return; }
  if (me && !p.isPublic && me.role === 'student') {
    fetch('/api/shortlist', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
      .then(function(r){ return r.json(); }).then(function(j){ if (j && j.error) toast(j.error); else toast('Saved to your shortlist'); }).catch(function(){ toast('Saved here for now'); });
  } else if (p.isPublic && F.locked(p)) toast('A public university is added to your shortlist by your counsellor once a package covers it — saved here for now.');
  else toast(me ? 'Saved here for now' : 'Saved here — sign in and we keep it with your file');
  saved.add(String(id)); persistSaved(); btn.setAttribute('aria-pressed', 'true'); btn.textContent = '♥';
}
function persistSaved(){ try { localStorage.setItem('glv-saved', JSON.stringify(Array.from(saved))); } catch (e) {} }

function cmpBar(){
  var bar = $('#fcmp'); if (!bar) return;
  var n = compared.size;
  bar.hidden = n < 1;
  $('#fcmpText').textContent = n ? 'Comparing ' + n + ' programme' + (n === 1 ? '' : 's') + (n < 2 ? ' — pick one more' : '') : 'Pick programmes to compare';
  $('#fcmpGo').disabled = n < 2;
  /* Round 177 (item 1): while the bar shows, the WhatsApp / chat corner is
     lifted above it by the bar's own height (it wraps to two lines at
     618px), so "Clear" and "Compare side by side" are not under the button. */
  document.body.classList.toggle('fcmp-open', n >= 1);
  if (n >= 1) document.documentElement.style.setProperty('--fcmp-h', bar.offsetHeight + 'px');
}
function compareNow(){
  var ps = Array.from(compared).map(function(id){ return rows.find(function(r){ return String(r.id) === id; }); }).filter(Boolean);
  if (ps.length < 2) return;
  var rq = function(p){ return p.reqs || {}; };
  var name = function(p){ return F.locked(p) ? 'Public university in ' + ((countries[p.country] || {}).name || p.country) : esc(p.program) + '<br><small>' + esc(p.shortName || p.university) + '</small>'; };
  var yn = function(v){ return v === true ? 'Yes' : v === false ? 'No' : '—'; };
  var val = function(v, suf){ return (v === null || v === undefined || v === '') ? '—' : esc(v) + (suf || ''); };
  var dl = function(p){ var d = F.nextDeadline(p); return d.at ? d.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : d.closed ? 'Intake closed' : 'To confirm'; };
  var fee = function(p){ return F.locked(p) ? 'Unlock with a package' : (F.feeIndicative && F.feeIndicative(p)) ? (Number(p.totalInr) > 0 ? F.money(p.totalInr) + ' total (indicative)' : 'Fee on request') : F.feeUnknown(p) ? 'To be confirmed' : F.tuitionOf(p) === 0 ? 'No tuition' : F.money(p.totalInr) + ' total'; };
  var lines = [['Level', function(p){ return F.LEVELS[String(p.level).toLowerCase()] || p.level; }], ['Field', function(p){ return p.field; }], ['Country', function(p){ return (countries[p.country] || {}).name || p.country; }],
    ['Type', function(p){ return (F.typeLabel ? F.typeLabel(p) : (p.isPublic ? 'Public' : 'Private')) || '—'; }], ['Applying', function(p){ return F.feeOf(p) === 'free' ? 'Free to apply' : 'With a package'; }], ['Cost', fee], ['Tuition / semester', function(p){ var t = F.tuitionOf(p); return t == null ? '—' : t === 0 ? 'None' : '€' + t; }],
    ['Next deadline', dl], ['CGPA asked', function(p){ return val(p.minCgpa); }], ['IELTS', function(p){ return val(rq(p).ieltsMin); }], ['TOEFL', function(p){ return val(rq(p).toeflMin); }], ['MOI letter', function(p){ return yn(rq(p).moiAccepted); }],
    ['GRE', function(p){ return rq(p).greRequired === true ? 'Required' + (rq(p).greMin ? ' (' + rq(p).greMin + ')' : '') : rq(p).greRequired === false ? 'Not needed' : '—'; }], ['German', function(p){ return val(rq(p).germanLevel); }], ['Bachelor’s', function(p){ return val(rq(p).bachelorYears, '-year'); }],
    ['Work experience', function(p){ return rq(p).workExpRequired === true ? (rq(p).workExpMonths ? rq(p).workExpMonths + ' months' : 'Yes') : rq(p).workExpRequired === false ? 'No' : '—'; }], ['Restricted admission', function(p){ return yn(rq(p).restricted); }]];
  var h = '<table class="fcmpt"><thead><tr><th></th>' + ps.map(function(p){ return '<th>' + name(p) + '</th>'; }).join('') + '</tr></thead><tbody>'
    + lines.map(function(l){ return '<tr><td>' + l[0] + '</td>' + ps.map(function(p){ return '<td>' + l[1](p) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  $('#fmodalBody').innerHTML = h; $('#fmodal').hidden = false; document.body.style.overflow = 'hidden';
}
function closeModal(){ $('#fmodal').hidden = true; document.body.style.overflow = ''; }
/* Round 169 (WEB-20.4): the clipboard refused — the link in a box under the
   button, selected, instead of the browser's own prompt box. */
function shareBox(link){
  var box = $('#fshareBox');
  if (!box) {
    box = document.createElement('div'); box.id = 'fshareBox'; box.className = 'fsharebox';
    box.innerHTML = '<label for="fshareLink">Copy this link</label><input id="fshareLink" readonly><button type="button" class="flink" id="fshareShut">Close</button>';
    var head = $('.fhead'); (head || document.body).after(box);
    box.querySelector('#fshareShut').addEventListener('click', function(){ box.remove(); });
  }
  var i = box.querySelector('input'); i.value = link; i.focus(); i.select();
}

var toastAt = 0;
function toast(msg){
  var t = $('#ftoast'); if (!t) { t = document.createElement('div'); t.id = 'ftoast'; t.setAttribute('role', 'status'); t.style.cssText = 'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:60;background:#0b1e31;color:#fff;padding:10px 16px;border-radius:10px;font:600 13.5px/1.4 Inter,sans-serif;max-width:min(92vw,520px);box-shadow:0 10px 30px rgba(0,0,0,.3)'; document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; var at = ++toastAt; setTimeout(function(){ if (at === toastAt) t.hidden = true; }, 4200);
}

function set(k, v){ if (v === '' || v == null || v === false) delete f[k]; else f[k] = String(v); shown = BOOT.page; render(); }

document.addEventListener('change', function(e){
  var i = e.target;
  /* Round 15 Oct (11): ticking "Not told us yet" forgets the CGPA; unticking
     it uses what the slider shows. */
  if (i.id === 'fcgnone') { var sl = $('#fcgpa'); set('cgpa', i.checked ? '' : (sl ? sl.value : '')); return; }
  if (!i.name || !i.closest('#frail')) return;
  if (i.type === 'radio') set(i.name, i.value);
  else if (i.type === 'checkbox') set(i.name, i.checked ? i.value : '');
  else if (i.name === 'cgpa') set('cgpa', i.value);
});
document.addEventListener('input', function(e){ var i = e.target; if (i.id === 'fcgpa') { var o = i.nextElementSibling; if (o) o.textContent = 'CGPA ' + i.value; if (i.parentNode) i.parentNode.classList.remove('empty'); var n = $('#fcgnone'); if (n) n.checked = false; } });
document.addEventListener('click', function(e){
  var t = e.target.closest('[data-cleartag],[data-clear],[data-save],[data-cmp],[data-view],#fmore,#fshare,#fcmpGo,#fcmpClear,#fmodalClose,#fsheetBtn,#fsheetClose,#fmodal');
  if (!t) return;
  if (t.dataset.cleartag !== undefined) { e.preventDefault(); removeTag(t.dataset.cleartag); return; }
  if (t.dataset.clear) { e.preventDefault(); if (t.dataset.clear === '*') { var keepSort = f.sort, keepView = f.view; f = {}; if (keepSort) f.sort = keepSort; if (keepView) f.view = keepView; } else { delete f[t.dataset.clear]; if (t.dataset.clear === 'gre') ['greScore', 'greQuant', 'greVerbal', 'greAwa'].forEach(function(k){ delete f[k]; }); } shown = BOOT.page; render(); return; }
  if (t.dataset.save) { e.preventDefault(); save(t.dataset.save, t); return; }
  if (t.dataset.cmp) { e.preventDefault(); var id = String(t.dataset.cmp); if (compared.has(id)) compared.delete(id); else if (compared.size >= 3) { toast('Compare up to three at a time'); return; } else compared.add(id); t.setAttribute('aria-pressed', String(compared.has(id))); cmpBar(); return; }
  if (t.dataset.view) { e.preventDefault(); set('view', t.dataset.view === 'list' ? '' : t.dataset.view); return; }
  if (t.id === 'fmore') { e.preventDefault(); shown += BOOT.page; render(); return; }
  if (t.id === 'fshare') { e.preventDefault(); var link = location.origin + url(); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function(){ toast('Link copied — anyone who opens it sees this search'); }, function(){ shareBox(link); }); return; }
  if (t.id === 'fcmpGo') { e.preventDefault(); compareNow(); return; }
  if (t.id === 'fcmpClear') { e.preventDefault(); compared.clear(); $$('[data-cmp]').forEach(function(b){ b.setAttribute('aria-pressed', 'false'); }); cmpBar(); return; }
  if (t.id === 'fmodalClose' || (t.id === 'fmodal' && e.target === t)) { e.preventDefault(); closeModal(); return; }
  if (t.id === 'fsheetBtn') { e.preventDefault(); $('#frail').classList.add('open'); t.setAttribute('aria-expanded', 'true'); return; }
  if (t.id === 'fsheetClose') { e.preventDefault(); $('#frail').classList.remove('open'); $('#fsheetBtn').setAttribute('aria-expanded', 'false'); return; }
});
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') { if (!$('#fmodal').hidden) closeModal(); else $('#frail').classList.remove('open'); } });
var sortEl = $('#fsort'); if (sortEl) sortEl.addEventListener('change', function(){ set('sort', sortEl.value === F.defaultSort(result && result.said) ? '' : sortEl.value); });
var form = $('#ffilters'); if (form) form.addEventListener('submit', function(e){
  e.preventDefault();
  /* Enter on a highlighted suggestion adds that tag; otherwise the words search names. */
  var sel = $('#fsug button[aria-selected="true"]');
  if (sel && !$('#fsug').hidden) { addTag(sel.dataset.tag); return; }
  set('q', (form.q.value || '').trim()); hideSug();
});

/* ---- 10 Oct: the tag search. Suggestions from /api/tags as you type; a
   pick adds a chip (f.tags, ';'-joined in the address); the arrow keys walk
   the list, Escape closes it. ---- */
function addTag(t){
  t = String(t || '').trim(); if (!t) return;
  var list = F.tagList(f.tags);
  if (!list.some(function(x){ return x.toLowerCase() === t.toLowerCase(); })) list.push(t);
  var qb = $('#fq'); if (qb) qb.value = '';
  delete f.q;
  hideSug();
  set('tags', list.join(';'));
  if (qb) qb.focus();
}
function removeTag(t){
  var list = F.tagList(f.tags).filter(function(x){ return x.toLowerCase() !== String(t).toLowerCase(); });
  set('tags', list.join(';'));
}
var sugTimer = null, sugLast = '';
function hideSug(){ var s = $('#fsug'); if (s) { s.hidden = true; s.innerHTML = ''; } var qb = $('#fq'); if (qb) qb.setAttribute('aria-expanded', 'false'); }
function drawSug(list){
  var s = $('#fsug'); if (!s) return;
  if (!list.length) { s.innerHTML = '<div class="none">No tag by that name — press Search to look through the names.</div>'; s.hidden = false; return; }
  var by = {}, order = [];
  list.forEach(function(x){ if (!by[x.type]) { by[x.type] = []; order.push(x.type); } by[x.type].push(x); });
  s.innerHTML = order.map(function(t){ return '<h5>' + esc(t) + '</h5>' + by[t].map(function(x){ return '<button type="button" role="option" aria-selected="false" data-tag="' + esc(x.value) + '">' + esc(x.value) + '</button>'; }).join(''); }).join('');
  s.hidden = false;
  var qb = $('#fq'); if (qb) qb.setAttribute('aria-expanded', 'true');
}
function askSug(){
  var qb = $('#fq'); if (!qb) return;
  var q = qb.value.trim();
  if (q.length < 2) { hideSug(); return; }
  sugLast = q;
  fetch('/api/tags?q=' + encodeURIComponent(q) + '&limit=24').then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    if (!d || qb.value.trim() !== q) return;
    drawSug(d.suggestions || []);
  }).catch(function(){});
}
function moveSug(dir){
  var items = $$('#fsug button'); if (!items.length) return;
  var i = items.findIndex(function(b){ return b.getAttribute('aria-selected') === 'true'; });
  items.forEach(function(b){ b.setAttribute('aria-selected', 'false'); });
  i = i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
  items[i].setAttribute('aria-selected', 'true');
  if (items[i].scrollIntoView) items[i].scrollIntoView({ block: 'nearest' });
}
var qbox = $('#fq');
if (qbox) {
  qbox.addEventListener('input', function(){ clearTimeout(sugTimer); sugTimer = setTimeout(askSug, 160); });
  qbox.addEventListener('focus', function(){ if (qbox.value.trim().length >= 2) askSug(); });
  qbox.addEventListener('keydown', function(e){
    var s = $('#fsug');
    if (e.key === 'Escape') { if (s && !s.hidden) { e.preventDefault(); e.stopPropagation(); hideSug(); } return; }
    if (s && !s.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); moveSug(e.key === 'ArrowDown' ? 1 : -1); }
  });
}
document.addEventListener('click', function(e){
  var b = e.target.closest('#fsug button');
  if (b) { e.preventDefault(); addTag(b.dataset.tag); return; }
  if (!e.target.closest('#fsearchWrap')) hideSug();
});

/* The catalogue as THIS visitor may see it — names where a package covers them. */
fetch('/api/auth/me', { credentials: 'same-origin' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(j){ me = j && (j.user || j.me || (j.id ? j : null)); }).catch(function(){});
fetch('/api/catalogue', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function(r){ return r.json(); }).then(function(d){
  if (d && d.countries) Object.keys(d.countries).forEach(function(k){ countries[k] = countries[k] || d.countries[k]; });
  var all = (d && d.programmes || []).filter(function(p){ return p.level && p.field; });
  /* Round 176: the named rows are kept; the placeholders that came with
     them are the opening pool, replaced per filter by /api/find/locked. */
  named = all.filter(function(p){ return !F.locked(p); });
  lockedPool = all.filter(function(p){ return F.locked(p); });
  lockedMore = !!(d && d.more);
  if (!Object.keys(f).some(function(k){ return k !== 'sort' && k !== 'view'; })) lockedFor = '';
  rows = named.concat(lockedPool);
  /* Options the server says exist and the first paint did not offer. */
  if (d && d.facets) addMissingOptions(d.facets);
  render();
}).catch(function(){ /* the server's rows stay on screen */ });
/* Round 176: a value the catalogue holds that the rail does not offer yet
   gets its option — from the server's facet lists, with no count. */
function addMissingOptions(fc){
  var add = function(name, values, label){
    var inputs = $$('#frail input[name="' + name + '"]'); if (!inputs.length) return;
    var have = {}; inputs.forEach(function(i){ have[i.value] = true; });
    var box = inputs[inputs.length - 1].closest('.fgb'); if (!box) return;
    (values || []).forEach(function(v){ if (have[v]) return;
      var l = document.createElement('label'); l.className = 'fopt';
      l.innerHTML = '<input type="radio" name="' + esc(name) + '" value="' + esc(v) + '"> <span>' + esc(label(v)) + '</span>';
      box.appendChild(l); });
  };
  add('country', fc.country, function(v){ return (countries[v] || {}).name || v; });
  add('level', fc.level, function(v){ return F.LEVELS[v] || v; });
  add('field', fc.field, function(v){ return String(v).replace(/&amp;/g, '&'); });
  add('intake', fc.intake, function(v){ var t = F.termByKey(v); return t ? t.season.charAt(0).toUpperCase() + t.season.slice(1) + ' ' + t.year : v; });
}
})();`;

module.exports = { makeFindPage, FIND_CSS, FIND_PAGE_JS };
