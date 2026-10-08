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

const esc = FIND.esc;

/* The narrowing filters that make a page worth indexing on their own. Anything
   else in the address — a CGPA, a sort, a test score — is one visitor's search. */
const CANON_KEYS = ['country', 'level', 'field'];

const PAGE = 40;

function makeFindPage({ templates, fill, metaHoles, liveCatalogue, liveCountries, absolute, defaultOg, content, slugOf }) {

  /* The rows as a signed-out visitor is allowed to see them — the same
     withholding /api/catalogue does with no package: a public university's
     name, city and website stay behind. The office's "gate" setting is
     honoured the same way. */
  function publicRows() {
    let gate = 'gated';
    try { const f = content && content.get('finder'); if (f && f.gate) gate = f.gate; } catch (e) { /* strictest */ }
    return liveCatalogue().filter(p => !p.searchOnly && p.level && p.field).map(p => {
      if (!p.isPublic || gate === 'open') return Object.assign({ uniSlug: slugOf(p.university) }, p);
      if (gate === 'names') return Object.assign({ uniSlug: slugOf(p.university) }, p, { totalInr: 0, freeTuition: false, feeHidden: true });
      return {
        id: '', country: p.country, level: p.level, field: p.field, band: p.band, isPublic: true, fit: p.fit,
        intakes: p.intakes, feeModel: p.feeModel, totalInr: p.totalInr, freeTuition: (p.totalInr || 0) === 0,
        minCgpa: p.minCgpa, germanGpa: p.germanGpa, reqs: p.reqs, uKey: p.uKey,
        nLen: String(p.program || '').length, uLen: String(p.shortName || p.university || '').length,
      };
    });
  }

  function canonicalQuery(f) {
    const c = {};
    CANON_KEYS.forEach(k => { if (f[k]) c[k] = f[k]; });
    return FIND.toQuery(c);
  }

  const opt = (v, label, n, cur) => '<label class="fopt' + (n === 0 ? ' none' : '') + '"><input type="' + (cur.multi ? 'checkbox' : 'radio') + '" name="' + cur.name + '" value="' + esc(v) + '"' + (cur.value === v ? ' checked' : '') + '> <span>' + esc(label) + '</span><em>' + Number(n || 0).toLocaleString('en-IN') + '</em></label>';

  /* The rail, rendered once here and re-counted in the browser. */
  function railHtml(f, R, countries) {
    const g = (title, body, open) => '<details class="fg"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary><div class="fgb">' + body + '</div></details>';
    const cs = Object.keys(R.facets.country).sort((a, b) => R.facets.country[b] - R.facets.country[a]);
    const dest = '<label class="fopt"><input type="radio" name="country" value=""' + (!f.country ? ' checked' : '') + '> <span>All destinations</span></label>'
      + cs.map(c => opt(c, (countries[c] ? countries[c].flag + ' ' + countries[c].name : c), R.facets.country[c], { name: 'country', value: f.country })).join('');
    const lv = Object.keys(R.facets.level).sort();
    const level = '<label class="fopt"><input type="radio" name="level" value=""' + (!f.level ? ' checked' : '') + '> <span>Any level</span></label>'
      + lv.map(l => opt(l, FIND.LEVELS[l] || l, R.facets.level[l], { name: 'level', value: String(f.level || '').toLowerCase() })).join('');
    const fs = Object.keys(R.facets.field).sort((a, b) => R.facets.field[b] - R.facets.field[a]);
    const field = '<label class="fopt"><input type="radio" name="field" value=""' + (!f.field ? ' checked' : '') + '> <span>Any field</span></label>'
      + fs.slice(0, 40).map(x => opt(x, x.replace(/&amp;/g, '&'), R.facets.field[x], { name: 'field', value: f.field })).join('')
      + (fs.length > 40 ? '<div class="fmore-note">' + (fs.length - 40) + ' more fields in the search box above</div>' : '');
    const cg = '<div class="fcg"><input type="range" id="fcgpa" name="cgpa" min="5" max="10" step="0.1" value="' + esc(f.cgpa || '10') + '" aria-label="Your CGPA">'
      + '<output for="fcgpa">' + (f.cgpa ? 'CGPA ' + esc(f.cgpa) : 'Not told us yet') + '</output>'
      + (f.cgpa ? '<button type="button" class="flink" data-clear="cgpa">clear</button>' : '') + '</div>';
    const tu = [['', 'Any tuition', null], ['0', 'No tuition fee', R.facets.tuition0], ['500', 'Up to €500 / semester', null], ['1500', 'Up to €1,500', null], ['4000', 'Up to €4,000', null], ['6000', 'Up to €6,000', null]]
      .map(([v, l, n]) => '<label class="fopt"><input type="radio" name="tuition" value="' + v + '"' + ((f.tuition || '') === v ? ' checked' : '') + '> <span>' + l + '</span>' + (n != null ? '<em>' + n + '</em>' : '') + '</label>').join('');
    const terms = FIND.upcomingTerms(4).filter(t => R.facets.intake[t.key]);
    const it = '<label class="fopt"><input type="radio" name="intake" value=""' + (!f.intake ? ' checked' : '') + '> <span>Any intake</span></label>'
      + terms.map(t => opt(t.key, t.season.charAt(0).toUpperCase() + t.season.slice(1) + ' ' + t.year, R.facets.intake[t.key], { name: 'intake', value: f.intake })).join('');
    const ap = '<label class="fopt"><input type="radio" name="apply" value=""' + (!f.apply ? ' checked' : '') + '> <span>Either</span></label>'
      + opt('free', 'Free to apply', R.facets.apply.free, { name: 'apply', value: f.apply })
      + opt('package', 'With a package', R.facets.apply.package, { name: 'apply', value: f.apply });
    const te = '<label class="fopt"><input type="checkbox" name="moi" value="1"' + (f.moi ? ' checked' : '') + '> <span>MOI letter accepted</span><em>' + R.facets.moi + '</em></label>'
      + '<label class="fopt"><input type="checkbox" name="nogre" value="1"' + (f.nogre ? ' checked' : '') + '> <span>No GRE needed</span><em>' + R.facets.nogre + '</em></label>'
      + '<label class="fopt"><input type="checkbox" name="restricted" value="open"' + (f.restricted === 'open' ? ' checked' : '') + '> <span>Open admission only</span><em>' + R.facets.open + '</em></label>';
    return g('Destination', dest, true) + g('Level', level, true) + g('Field', field, !!f.field) + g('Your CGPA', cg, !!f.cgpa)
      + g('Tuition', tu, !!f.tuition) + g('Intake', it, !!f.intake) + g('Applying', ap, !!f.apply) + g('Tests & admission', te, !!(f.moi || f.nogre || f.restricted));
  }

  function chipsHtml(f, countries) {
    const chips = [];
    FIND.KEYS.forEach(k => {
      if (!f[k] || k === 'sort' || k === 'view') return;
      const l = FIND.chipLabel(k, f[k], countries);
      if (l) chips.push('<button type="button" class="fchip" data-clear="' + esc(k) + '">' + esc(l) + ' <b aria-hidden="true">×</b><span class="offscreen"> remove</span></button>');
    });
    return chips.length ? chips.join('') + '<button type="button" class="flink" data-clear="*">Clear all</button>' : '';
  }

  function profileStrip(R) {
    if (R.said) {
      const parts = Object.keys(R.student).filter(k => k !== 'restrictedOk').length;
      return '<div class="fprof said"><b>Checked against what you told us</b> — ' + parts + ' detail' + (parts === 1 ? '' : 's') + '. '
        + (R.turned ? R.turned.toLocaleString('en-IN') + ' programme' + (R.turned === 1 ? '' : 's') + ' ask a higher CGPA and ' + (R.turned === 1 ? 'is' : 'are') + ' not shown; anything else you fall short of is ranked lower, not hidden. ' : '')
        + '<a href="index.html#find">Change your answers →</a></div>';
    }
    return '<div class="fprof"><b>Tell us your scores to see which of these would take you.</b> Your CGPA, IELTS and bachelor’s length are enough to start — '
      + '<a href="index.html#find">add them on the finder →</a> or <a href="login.html?signup=1">create a free account</a> and we keep them.</div>';
  }

  function bodyHtml(f, R, countries) {
    const rows = R.rows.slice(0, PAGE);
    const ctx = { countries, said: R.said };
    const list = rows.length ? rows.map(p => FIND.rowHtml(p, ctx)).join('') : FIND.emptyHtml(f);
    const sort = '<label class="fsort">Sort <select id="fsort">' + Object.keys(FIND.SORTS).map(k => '<option value="' + k + '"' + ((f.sort || FIND.defaultSort(R.said)) === k ? ' selected' : '') + '>' + FIND.SORTS[k] + '</option>').join('') + '</select></label>';
    const view = '<div class="fview" role="group" aria-label="View"><button type="button" data-view="list" aria-pressed="' + (f.view !== 'uni') + '">List</button><button type="button" data-view="uni" aria-pressed="' + (f.view === 'uni') + '">By university</button></div>';
    return '<form id="ffilters" class="ffilters" action="/find-university" method="get">'
      + '<div class="fsearch"><input type="search" name="q" value="' + esc(f.q || '') + '" placeholder="Programme, university or city" aria-label="Search programmes"><button type="submit" class="btn btn-green btn-sm">Search</button></div>'
      + '<div class="fchips" id="fchips">' + chipsHtml(f, countries) + '</div>'
      + '<div class="flayout"><button type="button" class="btn btn-sm fsheet-btn" id="fsheetBtn" aria-controls="frail" aria-expanded="false">Filters<span id="fcount"></span></button>'
      + '<aside class="frail" id="frail"><div class="frail-head"><b>Filters</b><button type="button" class="flink" id="fsheetClose">Done</button></div>' + railHtml(f, R, countries) + '</aside>'
      + '<div class="fresults">'
      + '<div class="fhead"><h2 id="fsummary">' + R.total.toLocaleString('en-IN') + ' programme' + (R.total === 1 ? '' : 's') + ' at ' + R.unis.toLocaleString('en-IN') + ' universit' + (R.unis === 1 ? 'y' : 'ies') + (R.total === 1 ? ' matches' : ' match') + '</h2>'
      + '<div class="ftools">' + sort + view + '<button type="button" class="btn btn-sm" id="fshare">Share this search</button></div></div>'
      + profileStrip(R)
      + '<div id="flist" class="flist" data-total="' + R.total + '">' + list + '</div>'
      + (R.total > PAGE ? '<div class="fpage"><button type="button" class="btn btn-sm" id="fmore">Show ' + Math.min(PAGE, R.total - PAGE) + ' more</button><span>' + PAGE + ' of ' + R.total.toLocaleString('en-IN') + '</span></div>' : '')
      + '</div></div></form>'
      + '<div class="fcmp" id="fcmp" hidden><span id="fcmpText">Comparing 0 programmes</span><button type="button" class="btn btn-green btn-sm" id="fcmpGo">Compare side by side →</button><button type="button" class="flink" id="fcmpClear">Clear</button></div>'
      + '<div class="fmodal" id="fmodal" hidden><div class="fmodal-in" role="dialog" aria-modal="true" aria-labelledby="fmodalH"><div class="fmodal-head"><h2 id="fmodalH">Side by side</h2><button type="button" class="flink" id="fmodalClose">Close</button></div><div id="fmodalBody"></div></div></div>';
  }

  function render(query) {
    const t = templates();
    if (!t) return null;
    const f = FIND.parse(query || '');
    const countries = liveCountries();
    const rows = publicRows();
    const R = FIND.run(rows, f, REQS);
    const name = FIND.title(f, countries, null);
    const title = FIND.title(f, countries, R.total);
    const indexable = Object.keys(f).every(k => CANON_KEYS.includes(k)) && R.total > 0;
    const canonical = absolute('/find-university' + canonicalQuery(f));
    const desc = R.total.toLocaleString('en-IN') + ' programmes at ' + R.unis + ' universities' + (f.country && countries[f.country] ? ' in ' + countries[f.country].name : '')
      + ' — what each costs in total, when to apply, the CGPA and English score it asks for, and which ones you can apply to free through Glovels.';
    const page = fill(t.page, Object.assign(metaHoles({
      title, desc, canonical, keywords: 'find university, ' + name.toLowerCase() + ', fees, intakes, CGPA, Indian students',
      image: defaultOg, imageAlt: 'Glovels — find your university', type: 'website', indexable,
      jsonld: { '@context': 'https://schema.org', '@type': 'SearchResultsPage', name: title, url: canonical },
    }), {
      H1: name,
      DATELINE: 'Every programme we track, filtered to what fits you. Change a filter and the address changes with it — bookmark it, share it, come back to it.',
      CRUMBS: '<a href="index.html">Home</a> / Find University',
      BODY: bodyHtml(f, R, countries),
    }));
    const boot = '<script>window.FIND_BOOT=' + JSON.stringify({ f, countries, page: PAGE }).replace(/</g, '\\u003c') + '</script>'
      + '<script src="/js/find.js" defer></script><script src="/js/reqs.js" defer></script><script src="/js/find-page.js" defer></script>';
    return { html: page.replace('</head>', FIND_CSS + '</head>').replace('</body>', boot + '</body>'), indexable };
  }

  return { render, publicRows };
}

const FIND_CSS = `<style>/* GLOVELS-FIND-CSS */
#page.prose{max-width:var(--maxw)}
.ffilters{display:block}
.fsearch{display:flex;gap:8px;margin:0 0 12px}
.fsearch input{flex:1;min-width:0;padding:10px 14px;border:1px solid var(--line);border-radius:10px;font:400 14.5px/1.3 var(--sans);background:var(--paper)}
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
.funi{margin:0 0 6px;font:700 15px/1.3 var(--sans);color:var(--navy-900);padding:10px 0 0}
.fcmp{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;padding:12px 18px;background:var(--navy-900);color:#fff;font:600 14px/1.3 var(--sans);box-shadow:0 -8px 30px rgba(0,0,0,.25)}
.fcmp .flink{color:#c8d6e4}
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
try { (JSON.parse(localStorage.getItem('glv-saved') || '[]') || []).forEach(function(id){ saved.add(String(id)); }); } catch (e) {}

function url(){ return '/find-university' + F.toQuery(f); }
function write(){ try { history.replaceState(null, '', url()); } catch (e) {} }
function esc(s){ return F.esc(s); }

function ctx(){ return { countries: countries, said: result && result.said, saved: saved, compared: compared }; }

function render(){
  if (!rows) return;
  result = F.run(rows, f, R);
  var list = $('#flist'), out = '';
  var slice = result.rows.slice(0, shown);
  if (!slice.length) out = F.emptyHtml(f);
  else if (f.view === 'uni') {
    var by = {}, order = [];
    slice.forEach(function(p){ var k = p.uKey || p.university || p.id; if (!by[k]) { by[k] = []; order.push(k); } by[k].push(p); });
    out = order.map(function(k){ var g = by[k]; var name = g[0]._locked ? 'A public university in ' + ((countries[g[0].country] || {}).name || g[0].country) : (g[0].shortName || g[0].university);
      return '<h3 class="funi">' + esc(name) + ' <small style="color:var(--muted);font-weight:400">' + g.length + ' programme' + (g.length === 1 ? '' : 's') + '</small></h3>' + g.map(function(p){ return F.rowHtml(p, ctx()); }).join(''); }).join('');
  } else out = slice.map(function(p){ return F.rowHtml(p, ctx()); }).join('');
  list.innerHTML = out;
  $('#fsummary').textContent = result.total.toLocaleString('en-IN') + ' programme' + (result.total === 1 ? '' : 's') + ' at ' + result.unis.toLocaleString('en-IN') + ' universit' + (result.unis === 1 ? 'y' : 'ies') + (result.total === 1 ? ' matches' : ' match');
  var pg = $('.fpage');
  if (result.total > shown) {
    if (!pg) { pg = document.createElement('div'); pg.className = 'fpage'; list.after(pg); }
    pg.innerHTML = '<button type="button" class="btn btn-sm" id="fmore">Show ' + Math.min(BOOT.page, result.total - shown) + ' more</button><span>' + shown + ' of ' + result.total.toLocaleString('en-IN') + '</span>';
  } else if (pg) pg.remove();
  chips(); counts(); profile(); cmpBar();
  document.title = F.title(f, countries, result.total) + ' | Glovels';
  var h1 = $('.page-hero h1'); if (h1) h1.textContent = F.title(f, countries, null);
  write();
}

function chips(){
  var out = '';
  F.KEYS.forEach(function(k){ if (!f[k] || k === 'sort' || k === 'view') return; var l = F.chipLabel(k, f[k], countries); if (l) out += '<button type="button" class="fchip" data-clear="' + esc(k) + '">' + esc(l) + ' <b aria-hidden="true">×</b></button>'; });
  if (out) out += '<button type="button" class="flink" data-clear="*">Clear all</button>';
  $('#fchips').innerHTML = out;
  var n = Object.keys(f).filter(function(k){ return k !== 'sort' && k !== 'view'; }).length;
  $('#fcount').textContent = n ? ' (' + n + ')' : '';
}

/* Re-count the rail from the live result: a facet shows what it would add. */
function counts(){
  var fc = result.facets;
  $$('#frail .fopt').forEach(function(l){
    var i = l.querySelector('input'), em = l.querySelector('em'); if (!i || !em) return;
    var n = null;
    if (i.name === 'country' && i.value) n = fc.country[i.value] || 0;
    else if (i.name === 'level' && i.value) n = fc.level[i.value] || 0;
    else if (i.name === 'field' && i.value) n = fc.field[i.value] || 0;
    else if (i.name === 'apply' && i.value) n = fc.apply[i.value] || 0;
    else if (i.name === 'intake' && i.value) n = fc.intake[i.value] || 0;
    else if (i.name === 'tuition' && i.value === '0') n = fc.tuition0;
    else if (i.name === 'moi') n = fc.moi;
    else if (i.name === 'nogre') n = fc.nogre;
    else if (i.name === 'restricted') n = fc.open;
    if (n == null) return;
    em.textContent = n.toLocaleString('en-IN'); l.classList.toggle('none', n === 0);
  });
  /* The boxes mirror the address, so a chip removed un-ticks its box. */
  $$('#frail input[type=radio]').forEach(function(i){ i.checked = (f[i.name] || '') === i.value; });
  $$('#frail input[type=checkbox]').forEach(function(i){ i.checked = !!f[i.name]; });
  var cg = $('#fcgpa'); if (cg) { cg.value = f.cgpa || '10'; var o = cg.nextElementSibling; if (o) o.textContent = f.cgpa ? 'CGPA ' + f.cgpa : 'Not told us yet'; }
  var s = $('#fsort'); if (s) s.value = f.sort || F.defaultSort(result.said);
  $$('.fview button').forEach(function(b){ b.setAttribute('aria-pressed', String((f.view || 'list') === b.dataset.view)); });
}

function profile(){
  var el = $('.fprof'); if (!el) return;
  if (result.said) {
    var parts = Object.keys(result.student).filter(function(k){ return k !== 'restrictedOk'; }).length;
    el.className = 'fprof said';
    el.innerHTML = '<b>Checked against what you told us</b> — ' + parts + ' detail' + (parts === 1 ? '' : 's') + '. '
      + (result.turned ? result.turned.toLocaleString('en-IN') + ' programme' + (result.turned === 1 ? '' : 's') + ' ask a higher CGPA and ' + (result.turned === 1 ? 'is' : 'are') + ' not shown; anything else you fall short of is ranked lower, not hidden. ' : '')
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
  $('#fcmpText').textContent = 'Comparing ' + n + ' programme' + (n === 1 ? '' : 's') + (n < 2 ? ' — pick one more' : '');
  $('#fcmpGo').disabled = n < 2;
}
function compareNow(){
  var ps = Array.from(compared).map(function(id){ return rows.find(function(r){ return String(r.id) === id; }); }).filter(Boolean);
  if (ps.length < 2) return;
  var rq = function(p){ return p.reqs || {}; };
  var name = function(p){ return F.locked(p) ? 'Public university in ' + ((countries[p.country] || {}).name || p.country) : esc(p.program) + '<br><small>' + esc(p.shortName || p.university) + '</small>'; };
  var yn = function(v){ return v === true ? 'Yes' : v === false ? 'No' : '—'; };
  var val = function(v, suf){ return (v === null || v === undefined || v === '') ? '—' : esc(v) + (suf || ''); };
  var dl = function(p){ var d = F.nextDeadline(p); return d.at ? d.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : d.closed ? 'Intake closed' : 'To confirm'; };
  var fee = function(p){ return F.locked(p) ? 'Unlock with a package' : F.feeUnknown(p) ? 'To be confirmed' : F.tuitionOf(p) === 0 ? 'No tuition' : F.money(p.totalInr) + ' total'; };
  var lines = [['Level', function(p){ return F.LEVELS[String(p.level).toLowerCase()] || p.level; }], ['Field', function(p){ return p.field; }], ['Country', function(p){ return (countries[p.country] || {}).name || p.country; }],
    ['Type', function(p){ return p.isPublic ? 'Public' : 'Private'; }], ['Applying', function(p){ return F.feeOf(p) === 'free' ? 'Free to apply' : 'With a package'; }], ['Cost', fee], ['Tuition / semester', function(p){ var t = F.tuitionOf(p); return t == null ? '—' : t === 0 ? 'None' : '€' + t; }],
    ['Next deadline', dl], ['CGPA asked', function(p){ return val(p.minCgpa); }], ['IELTS', function(p){ return val(rq(p).ieltsMin); }], ['TOEFL', function(p){ return val(rq(p).toeflMin); }], ['MOI letter', function(p){ return yn(rq(p).moiAccepted); }],
    ['GRE', function(p){ return rq(p).greRequired === true ? 'Required' + (rq(p).greMin ? ' (' + rq(p).greMin + ')' : '') : rq(p).greRequired === false ? 'Not needed' : '—'; }], ['German', function(p){ return val(rq(p).germanLevel); }], ['Bachelor’s', function(p){ return val(rq(p).bachelorYears, '-year'); }],
    ['Work experience', function(p){ return rq(p).workExpRequired === true ? (rq(p).workExpMonths ? rq(p).workExpMonths + ' months' : 'Yes') : rq(p).workExpRequired === false ? 'No' : '—'; }], ['Restricted admission', function(p){ return yn(rq(p).restricted); }], ['Fit', function(p){ return p.fit ? p.fit + '%' : '—'; }]];
  var h = '<table class="fcmpt"><thead><tr><th></th>' + ps.map(function(p){ return '<th>' + name(p) + '</th>'; }).join('') + '</tr></thead><tbody>'
    + lines.map(function(l){ return '<tr><td>' + l[0] + '</td>' + ps.map(function(p){ return '<td>' + l[1](p) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  $('#fmodalBody').innerHTML = h; $('#fmodal').hidden = false; document.body.style.overflow = 'hidden';
}
function closeModal(){ $('#fmodal').hidden = true; document.body.style.overflow = ''; }

var toastAt = 0;
function toast(msg){
  var t = $('#ftoast'); if (!t) { t = document.createElement('div'); t.id = 'ftoast'; t.setAttribute('role', 'status'); t.style.cssText = 'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:60;background:#0b1e31;color:#fff;padding:10px 16px;border-radius:10px;font:600 13.5px/1.4 Inter,sans-serif;max-width:min(92vw,520px);box-shadow:0 10px 30px rgba(0,0,0,.3)'; document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; var at = ++toastAt; setTimeout(function(){ if (at === toastAt) t.hidden = true; }, 4200);
}

function set(k, v){ if (v === '' || v == null || v === false) delete f[k]; else f[k] = String(v); shown = BOOT.page; render(); }

document.addEventListener('change', function(e){
  var i = e.target; if (!i.name || !i.closest('#frail')) return;
  if (i.type === 'radio') set(i.name, i.value);
  else if (i.type === 'checkbox') set(i.name, i.checked ? i.value : '');
  else if (i.name === 'cgpa') set('cgpa', i.value === '10' ? '' : i.value);
});
document.addEventListener('input', function(e){ var i = e.target; if (i.id === 'fcgpa') { var o = i.nextElementSibling; if (o) o.textContent = 'CGPA ' + i.value; } });
document.addEventListener('click', function(e){
  var t = e.target.closest('[data-clear],[data-save],[data-cmp],[data-view],#fmore,#fshare,#fcmpGo,#fcmpClear,#fmodalClose,#fsheetBtn,#fsheetClose,#fmodal');
  if (!t) return;
  if (t.dataset.clear) { e.preventDefault(); if (t.dataset.clear === '*') { var keepSort = f.sort, keepView = f.view; f = {}; if (keepSort) f.sort = keepSort; if (keepView) f.view = keepView; } else { delete f[t.dataset.clear]; if (t.dataset.clear === 'gre') ['greScore', 'greQuant', 'greVerbal', 'greAwa'].forEach(function(k){ delete f[k]; }); } shown = BOOT.page; render(); return; }
  if (t.dataset.save) { e.preventDefault(); save(t.dataset.save, t); return; }
  if (t.dataset.cmp) { e.preventDefault(); var id = String(t.dataset.cmp); if (compared.has(id)) compared.delete(id); else if (compared.size >= 3) { toast('Compare up to three at a time'); return; } else compared.add(id); t.setAttribute('aria-pressed', String(compared.has(id))); cmpBar(); return; }
  if (t.dataset.view) { e.preventDefault(); set('view', t.dataset.view === 'list' ? '' : t.dataset.view); return; }
  if (t.id === 'fmore') { e.preventDefault(); shown += BOOT.page; render(); return; }
  if (t.id === 'fshare') { e.preventDefault(); var link = location.origin + url(); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function(){ toast('Link copied — anyone who opens it sees this search'); }, function(){ prompt('Copy this link', link); }); return; }
  if (t.id === 'fcmpGo') { e.preventDefault(); compareNow(); return; }
  if (t.id === 'fcmpClear') { e.preventDefault(); compared.clear(); $$('[data-cmp]').forEach(function(b){ b.setAttribute('aria-pressed', 'false'); }); cmpBar(); return; }
  if (t.id === 'fmodalClose' || (t.id === 'fmodal' && e.target === t)) { e.preventDefault(); closeModal(); return; }
  if (t.id === 'fsheetBtn') { e.preventDefault(); $('#frail').classList.add('open'); t.setAttribute('aria-expanded', 'true'); return; }
  if (t.id === 'fsheetClose') { e.preventDefault(); $('#frail').classList.remove('open'); $('#fsheetBtn').setAttribute('aria-expanded', 'false'); return; }
});
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') { if (!$('#fmodal').hidden) closeModal(); else $('#frail').classList.remove('open'); } });
var sortEl = $('#fsort'); if (sortEl) sortEl.addEventListener('change', function(){ set('sort', sortEl.value === F.defaultSort(result && result.said) ? '' : sortEl.value); });
var form = $('#ffilters'); if (form) form.addEventListener('submit', function(e){ e.preventDefault(); set('q', (form.q.value || '').trim()); });

/* The catalogue as THIS visitor may see it — names where a package covers them. */
fetch('/api/auth/me', { credentials: 'same-origin' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(j){ me = j && (j.user || j.me || (j.id ? j : null)); }).catch(function(){});
fetch('/api/catalogue', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function(r){ return r.json(); }).then(function(d){
  if (d && d.countries) Object.keys(d.countries).forEach(function(k){ countries[k] = countries[k] || d.countries[k]; });
  rows = (d && d.programmes || []).filter(function(p){ return p.level && p.field; });
  render();
}).catch(function(){ /* the server's rows stay on screen */ });
})();`;

module.exports = { makeFindPage, FIND_CSS, FIND_PAGE_JS };
