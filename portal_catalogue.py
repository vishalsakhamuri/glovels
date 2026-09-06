"""The catalogue — what the site offers, edited by the people who know."""

BODY = """
    <style>
      /* Counter tiles. The column count was an inline style on every one of
         these, which beats any media query — so a row of four or five tiles
         pushed the page sideways on a phone. The count is a custom property
         now, and the row folds to two, then one, as the screen narrows. */
      .out.tiles{grid-template-columns:repeat(var(--tiles,4),1fr)}
      @media (max-width:820px){ .out.tiles{grid-template-columns:repeat(2,1fr)} }
      @media (max-width:430px){ .out.tiles{grid-template-columns:1fr} }
    </style>

    <div class="out tiles" style="--tiles:5;margin:0 0 18px">
      <div><b id="kLive">—</b><span>On the site</span></div>
      <div><b id="kSearch">—</b><span>Search only</span></div>
      <div><b id="kHidden">—</b><span>Hidden</span></div>
      <div><b id="kDest">—</b><span>Destinations</span></div>
      <div><b id="kFree">—</b><span>Zero tuition</span></div>
    </div>

    <div class="tabs" style="margin-bottom:16px">
      <button class="tab" data-t="prog" aria-selected="true">Programmes
        <span class="n" id="nProg">0</span></button>
      <button class="tab" data-t="dest" aria-selected="false">Destinations
        <span class="n" id="nDest">0</span></button>
      <button class="tab" data-t="sheet" aria-selected="false">Spreadsheet</button>
      <button class="tab" data-t="pages" aria-selected="false">University pages
        <span class="n" id="nPages">0</span></button>
      <button class="tab" data-t="log" aria-selected="false">Recent changes</button>
    </div>

    <!-- ------------------------------------------------------- programmes -->
    <section class="pane active" id="t-prog">
      <div class="p-card" style="margin-bottom:14px;display:flex;gap:11px;flex-wrap:wrap;
        align-items:center">
        <input id="q" placeholder="Search university, programme or field" style="flex:1;min-width:220px;
          padding:9px 12px;font:400 13px/1.4 var(--sans);border:1.5px solid #d8dde4;border-radius:9px">
        <select id="fc" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px"></select>
        <select id="fl" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px">
          <option value="">Any level</option>
          <option value="bachelor">Bachelor's</option>
          <option value="master">Master's</option>
          <option value="mba">MBA</option>
          <option value="diploma">Diploma / PG Diploma</option>
          <option value="pathway">Foundation / Pathway</option>
          <option value="phd">PhD</option>
        </select>
        <select id="ff" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px;max-width:230px"></select>
        <select id="ft" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px">
          <option value="">Every university</option>
          <option value="free">Fast-track — free</option>
          <option value="package">Comprehensive filing</option>
          <option value="pub">Public only</option>
          <option value="pri">Private only</option>
        </select>
        <select id="fb" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px">
          <option value="">Any budget</option>
          <option value="u10">Under ₹10L</option>
          <option value="u20">Under ₹20L</option>
          <option value="above20">₹20L+</option>
          <option value="elite">Top-ranked</option>
        </select>
        <!-- The same question the public finder asks, worded from this side of
             the desk: not "your CGPA" but "a student with this CGPA". It shows
             exactly what that student would be shown, which is the only way to
             check the entry rules without making an account and paying. -->
        <select id="fg" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px">
          <option value="">Any CGPA</option>
          <option value="9.5">A student with 9.0 – 10.0</option>
          <option value="8.5">…with 8.0 – 8.9</option>
          <option value="7.5">…with 7.5 – 7.9</option>
          <option value="7.2">…with 7.0 – 7.4</option>
          <option value="6.5">…with 6.0 – 6.9</option>
          <option value="5.5">…below 6.0</option>
        </select>
        <select id="fs" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px">
          <option value="">Everything</option>
          <option value="1">On the site</option>
          <option value="2">Search only</option>
          <option value="0">Hidden only</option>
        </select>
        <button type="button" class="btn btn-ghost btn-sm" id="fClear"
          style="display:none">Clear filters</button>
        <button type="button" class="btn btn-primary btn-sm" id="addProg">+ Add a programme</button>
      </div>

      <!-- The action bar sits above the table and only exists when something is
           ticked. A permanently visible row of destructive buttons invites the
           accident it is trying to prevent. -->
      <div class="p-card" id="bulkBar" style="display:none;margin-bottom:14px;gap:11px;
        flex-wrap:wrap;align-items:center;border-color:var(--navy-700)">
        <b id="bulkCount" style="font:700 13.4px/1.4 var(--sans);color:var(--navy-900)">
          0 selected</b>
        <button type="button" class="btn btn-ghost btn-sm" id="bulkShow">Put on the site</button>
        <button type="button" class="btn btn-ghost btn-sm" id="bulkSearch"
          title="A page and a search hit, but not a row on the home page">Search only</button>
        <button type="button" class="btn btn-ghost btn-sm" id="bulkHide">Take off the site</button>
        <button type="button" class="btn btn-ghost btn-sm" id="bulkDelete"
          style="margin-left:auto;color:#a5311f;border-color:#e8c3bc">Remove from the catalogue</button>
        <button type="button" class="btn btn-ghost btn-sm" id="bulkClear">Clear</button>
      </div>

      <div class="p-card" style="padding:0;overflow-x:auto">
        <table class="tbl" style="margin:0">
          <thead><tr>
            <th style="width:38px"><input type="checkbox" id="selAll"
              aria-label="Select everything this search found"></th>
            <th>Programme</th><th>Where</th><th>Type</th><th>Tuition</th>
            <th title="The CGPA this programme asks for">CGPA</th>
            <th>Next intake</th><th>Status</th><th></th></tr></thead>
          <tbody id="progRows"></tbody>
        </table>
        <div id="progPager"></div>
      </div>
      <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
        Anything you add here is on the home page finder straight away — no rebuild, no developer.
        A programme a student has already shortlisted is hidden rather than deleted, so their
        shortlist and application do not blank out.</p>
    </section>

    <!-- ------------------------------------------------------ destinations -->
    <section class="pane" id="t-dest">
      <div class="p-card" style="margin-bottom:14px">
        <h3>Add a destination</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">A programme
          cannot be added until its destination exists — that is what stops a typo creating a
          country called "Austrlia" that nobody notices for a month.</p>
        <div style="display:grid;grid-template-columns:90px 1fr 90px 1fr auto;gap:11px;align-items:end">
          <div class="field"><label for="cCode">Code</label>
            <input id="cCode" maxlength="2" placeholder="AU" style="text-transform:uppercase"></div>
          <div class="field"><label for="cName">Name</label>
            <input id="cName" placeholder="Australia"></div>
          <div class="field"><label for="cFlag">Flag</label>
            <input id="cFlag" placeholder="🇦🇺"></div>
          <div class="field"><label for="cRegion">Note</label>
            <input id="cRegion" placeholder="Post-study work rights"></div>
          <button type="button" class="btn btn-primary" id="addDest">Add</button>
        </div>
      </div>
      <div class="p-card" style="padding:0;overflow-x:auto">
        <table class="tbl" style="margin:0">
          <thead><tr><th>Destination</th><th>Code</th><th>Programmes</th><th>Status</th>
            <th>Entry requirements</th><th></th></tr></thead>
          <tbody id="destRows"></tbody>
        </table>
      </div>
    </section>

    <!-- ------------------------------------------------------- spreadsheet -->
    <section class="pane" id="t-sheet">
      <div class="p-card" style="margin-bottom:14px">
        <h3>Download the catalogue</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Every programme on this site, in one sheet, with the id in the first column.
          <b>Keep the id.</b> A row that arrives with an id is treated as a change to that
          programme; a row with the id blank is treated as a new one. That is the only
          thing the sheet needs you to preserve &mdash; the column headings are matched loosely.</p>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          <b>Clearing an id does not mean &ldquo;re-add this row&rdquo;.</b> A blank id means
          one thing only: this course has never been on the site. Clear it on a row that is
          already here and you get a second copy of the same programme &mdash; which is also
          what happens if a file of new universities is uploaded twice. Both are refused now,
          and the message names the id to paste if you meant to edit.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <select id="dlCountry" aria-label="Which destination to download" style="padding:9px 11px;
            font:600 12.8px/1.4 var(--sans);border:1.5px solid #d8dde4;border-radius:9px;background:#fff">
            <option value="">The whole catalogue</option>
          </select>
          <a class="btn btn-primary" id="dlXlsx" href="/api/staff/catalogue.xlsx">Download as Excel</a>
          <a class="btn btn-ghost" id="dlCsv" href="/api/staff/catalogue.csv">Download as CSV</a>
        </div>
        <p style="margin:10px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">One Excel file
          holds up to 60,000 rows; past that, download a destination at a time or the CSV, which has
          no limit.</p>
      </div>

      <div class="p-card">
        <h3>Upload your changes</h3>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Nothing is written when you upload. The file is read and you are shown exactly what
          it would do &mdash; what is new, what changes, what is already right, and what cannot
          be imported and why. It is applied only when you press the confirm button underneath
          that summary.</p>
        <div style="display:flex;gap:11px;flex-wrap:wrap;align-items:center">
          <input type="file" id="sFile" accept=".xlsx,.csv"
            style="font:400 13px/1.4 var(--sans);max-width:100%">
          <button type="button" class="btn btn-primary btn-sm" id="sCheck">Check the file</button>
          <span id="sBusy" style="display:none;font:600 12.4px/1.4 var(--sans);color:var(--muted)">
            Reading&hellip;</span>
        </div>
        <div id="sOut" style="margin-top:18px"></div>
      </div>

      <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
        A row can only use a destination that already exists on the Destinations tab &mdash;
        an unknown country code is rejected with the row, not quietly created. Deadlines must be
        written <code>YYYY-MM-DD</code>; Excel&rsquo;s own date cells come through in that form.
        Nothing is ever deleted by an import: to take a programme off the site, put
        <code>no</code> in the <b>on the site</b> column &mdash; or <code>search</code> to give
        its university a page that Google and the search box can find without listing it on
        the home page. That is the right word for most of a very large catalogue.</p>
    </section>

    <!-- ------------------------------------------------------------- log -->
    <!-- --------------------------------------------------- university pages -->
    <section class="pane" id="t-pages">
      <div class="p-card" style="margin-bottom:14px">
        <h3>A page for every university</h3>
        <p style="margin:0;font-size:12.8px;color:var(--muted);line-height:1.6">Every university in
          the catalogue has its own page on the site at <code>/university/&lt;name&gt;</code>, built
          from its programmes: fees, intakes, the CGPA it asks for and an Apply button. That page
          exists whether or not anything is written here, and whether the university is on the
          site or <b>search only</b> &mdash; the difference is that a search-only university is
          reached from Google and the search box, and is not listed on the home page. What you add here is what a table cannot
          carry &mdash; a paragraph about the place, a picture, and the title Google prints &mdash;
          and it is what makes the page rank for the university's name.</p>
      </div>
      <div class="blog-cols" style="display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start">
        <div class="p-card" style="padding:0">
          <div style="padding:10px 14px;border-bottom:1px solid var(--line)">
            <input id="uq" placeholder="Find a university" style="width:100%;padding:8px 11px;
              font:400 13px/1.4 var(--sans);border:1.5px solid #d8dde4;border-radius:9px"></div>
          <ul class="plist" id="uniList" style="list-style:none;margin:0;padding:0;max-height:64vh;
            overflow-y:auto"></ul>
          <div id="uniPager" style="padding:0 10px"></div>
        </div>
        <div class="p-card" id="uniEd">
          <p style="margin:0;font-size:13px;color:var(--muted);line-height:1.7">Pick a university on
            the left. The ones marked <b>written</b> have something on their page already.</p>
        </div>
      </div>
      <style>
        #uniList li{padding:11px 14px;border-bottom:1px solid var(--line);cursor:pointer;
          display:flex;flex-direction:column;gap:3px}
        #uniList li:hover{background:#f7f9fc}
        #uniList li.on{background:#f0f5fb;box-shadow:inset 3px 0 0 var(--navy-700)}
        #uniList b{font:700 12.8px/1.4 var(--sans);color:var(--navy-900)}
        #uniList span{font-size:11.4px;color:var(--muted)}
        #uniList .w{color:#14603a;font-weight:700}
        @media (max-width:1000px){ .blog-cols{grid-template-columns:1fr !important} }
        #uniEd textarea{width:100%;min-height:220px;padding:10px 12px;border:1.5px solid #d8dde4;
          border-radius:9px;font:400 13.6px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
        #uniEd input{width:100%;padding:9px 12px;border:1.5px solid #d8dde4;border-radius:9px;
          font:400 13.4px/1.4 var(--sans)}
        #uniEd .field{margin-bottom:13px}
        #uniEd .cnt{float:right;font:600 11px/1.3 var(--sans);color:var(--muted)}
        #uniEd .cnt.over{color:#7a2118}
        #uniEd .coverrow{display:grid;grid-template-columns:130px 1fr;gap:12px;align-items:start}
        #uniEd .coverrow img,#uniEd .coverrow .nopic{width:130px;aspect-ratio:16/9;object-fit:cover;
          border-radius:8px;border:1px solid var(--line);background:#f2f5f9;display:grid;
          place-items:center;font:600 11px/1.3 var(--sans);color:var(--muted)}
      </style>
    </section>

    <section class="pane" id="t-log">
      <div class="p-card"><ul class="doclist" id="logRows"></ul></div>
    </section>

    <!-- ------------------------------------------------------------ sheet -->
    <div class="modal" id="progModal" role="dialog" aria-modal="true">
      <div class="sheet" style="width:min(720px,100%)">
        <button class="sheet-close" data-close aria-label="Close">✕</button>
        <h3 id="pmTitle">Add a programme</h3>
        <p class="lead" id="pmLead">It appears on the home page finder as soon as you save.</p>
        <div id="pmBody"></div>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="pmSave">Save</button>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="button" class="btn btn-ghost" id="pmDelete" style="margin-left:auto">Remove</button>
        </div>
        <p id="pmErr" role="alert" style="display:none;margin:14px 0 0;padding:11px 13px;
          border-radius:10px;font:600 12.8px/1.5 var(--sans);background:#fdf3f2;
          border:1px solid #f0c8c4;color:#7a2118"></p>
      </div>
    </div>
"""

SCRIPT = r"""
/* PROGS is the page the database sent — never the whole catalogue. The office
   used to download every row and filter in the browser; at the size the
   catalogue is heading (two hundred thousand universities) that is a download
   nobody finishes, so the search, the filters and the paging all happen in the
   database and the screen only ever holds a hundred rows. */
let PROGS = [], DESTS = [], LOG = [], STATS = {}, FIELDS = [], TOTAL = 0, editing = null;
/* See the change handler at the foot of this file. */
let feeTouched = false;

/* Same fallback the server uses, so a row saved before the column existed
   reads as what it has always been rather than as charged. */
const feeOf = p => (p.feeModel === 'free' || p.feeModel === 'package')
  ? p.feeModel : (p.isPublic ? 'package' : 'free');

/* PICKED survives a repaint and a change of search: a counsellor filters to
   Poland, ticks four, filters to Spain, ticks two, and expects six. SHOWN is
   the page on the screen — the tick at the top selects that page, and the
   count above the table says how many the search found in all, so nobody
   reads "select all" as "select the two hundred thousand". */
const PICKED = new Set();
let SHOWN = [], PICK_CAPPED = 0;

const inr = n => n === 0 ? '₹0'
  : '₹' + (n / 100000).toFixed(n % 100000 ? 1 : 0) + 'L';

const LEVELS = [['', 'Any level'], ['master', "Master's"], ['bachelor', "Bachelor's"],
  ['mba', 'MBA'], ['phd', 'PhD'], ['diploma', 'Diploma'], ['foundation', 'Foundation']];
const BANDS = [['', 'Work it out from the fee'], ['u10', 'Under ₹10L'], ['u20', 'Under ₹20L'],
  ['above20', '₹20L+'], ['elite', 'Top-ranked']];

function nextIntake(p) {
  const now = new Date();
  const ds = (p.intakes || []).map(i => {
    const d = new Date(i.deadline);
    if (isNaN(d)) return null;
    while (d < now) d.setFullYear(d.getFullYear() + 1);
    return d;
  }).filter(Boolean).sort((a, b) => a - b);
  return ds[0] ? ds[0].toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}) : '—';
}

const destOf = c => DESTS.find(d => d.code === c) || {flag: '', name: c};

/*
 * The CGPA this programme actually asks for.
 *
 * Its own bar if the catalogue states one, otherwise the destination's rule
 * for that kind of university — the same formula the public finder and the
 * matcher use. Written once here so this screen cannot drift from the two that
 * decide what a student is shown and what they are sold.
 */
function barOf(p) {
  if (p.minCgpa != null && p.minCgpa !== '') return { n: Number(p.minCgpa), own: true };
  const f = (destOf(p.country) || {}).facts || {};
  const own = p.isPublic ? f.minCgpaPublic : f.minCgpaPrivate;
  return own == null || own === '' ? { n: null, own: false } : { n: Number(own), own: false };
}

/* ---------------------------------------------------------------- painting */

/* The filters as the API takes them. Two axes on one control (#ft), because
   the office needs both: how the student applies (which is what the site
   filters on) and whether the place is public (which the CGPA rules read).
   The CGPA box does exactly what the public finder does with the same
   number: a programme whose bar is above the student's is left out. */
function progQuery() {
  return {
    q: $('#q').value.trim(), country: $('#fc').value, level: $('#fl').value,
    field: $('#ff').value, type: $('#ft').value, band: $('#fb').value,
    cgpa: $('#fg').value, status: $('#fs').value,
  };
}

/* One request per keystroke is a request too many. The last one wins:
   a reply to a search the office has already typed past is thrown away. */
let progReq = 0;
async function fetchProgs() {
  const f = progQuery();
  const per = sizeOf('prog');
  const qs = Object.keys(f).filter(k => f[k] !== '').map(k => k + '=' + encodeURIComponent(f[k]));
  qs.push('page=' + (pageOf('prog') + 1), 'per=' + per);
  const mine = ++progReq;
  $('#progRows').style.opacity = '.55';
  try {
    const r = await api('GET', '/api/staff/catalogue?' + qs.join('&'));
    if (mine !== progReq) return;
    PROGS = r.programmes; TOTAL = r.total; STATS = r.stats || {}; FIELDS = r.fields || [];
    DESTS = r.countries; LOG = r.audit;
    /* The database clamps the page; follow it, or the pager says 7 while the
       rows are page 3's. */
    PAGE_AT.prog = Math.max(0, (r.page || 1) - 1);
    paintDests(); paintProgs(); paintLog();
  } finally { if (mine === progReq) $('#progRows').style.opacity = ''; }
}
let progTimer = null;
function fetchProgsSoon() {
  clearTimeout(progTimer);
  progTimer = setTimeout(() => { fetchProgs().catch(err => toast(err.message)); }, 220);
}

function paintProgs() {
  const f = progQuery();
  /* A filtered screen has to look filtered, or somebody reads a short list as
     a short catalogue and starts wondering where the universities went. */
  const on = [f.country, f.level, f.field, f.type, f.band, f.cgpa, f.status].filter(x => x !== '').length;
  $('#fClear').style.display = on ? '' : 'none';

  $('#nProg').textContent = STATS.total == null ? PROGS.length : STATS.total;
  SHOWN = PROGS.map(p => p.id);
  /* The pager walks the database, not an array: clicking a page asks for it. */
  $('#progPager').innerHTML = pagerHtml('prog', TOTAL, 'programmes', () => { fetchProgs().catch(err => toast(err.message)); });
  $('#progRows').innerHTML = PROGS.map(p => {
    const d = destOf(p.country);
    return '<tr' + (PICKED.has(p.id) ? ' style="background:#f4f7fb"' : '') + '>' +
      '<td><input type="checkbox" data-pick="' + esc(p.id) + '"' +
        (PICKED.has(p.id) ? ' checked' : '') + ' aria-label="Select ' + esc(p.university) + '"></td>' +
      '<td><b>' + esc(p.program) + '</b>' +
        (p.field ? '<br><span style="font-size:11.6px;color:var(--muted)">' + esc(p.field) + '</span>' : '') + '</td>' +
      '<td>' + (d.flag || '') + ' ' + esc(p.university) +
        (p.city ? '<br><span style="font-size:11.6px;color:var(--muted)">' + esc(p.city) + '</span>' : '') + '</td>' +
      '<td>' + (p.isPublic ? '<span class="st ok">Public</span>' : '<span class="st none">Private</span>') + '</td>' +
      '<td>' + (p.totalInr === 0 ? '<span class="st ok">Free</span>' : inr(p.totalInr)) + '</td>' +
      /* The bar, and whether it is this programme's own or its destination's.
         The two look identical to a student and are completely different to
         edit: one is changed here, the other on the Destinations tab and it
         moves every university in the country. */
      '<td style="white-space:nowrap">' + (() => {
        const b = barOf(p);
        if (b.n == null) return '<span style="color:var(--muted)">—</span>';
        return b.own
          ? '<b style="font:700 12.6px/1.4 var(--sans)">' + b.n + '</b>'
            + '<span style="display:block;font-size:10.8px;color:var(--muted)">its own</span>'
          : '<span style="font-size:12.6px">' + b.n + '</span>'
            + '<span style="display:block;font-size:10.8px;color:var(--muted)">'
            + esc(d.name || p.country) + ' rule</span>';
      })() + '</td>' +
      '<td style="font-size:12.4px">' + nextIntake(p) + '</td>' +
      '<td>' + (!p.active ? '<span class="st wait">Hidden</span>'
          : p.searchOnly ? '<span class="st" style="background:#eef2f7;color:var(--navy-800)">Search only</span>'
          : '<span class="st ok">On the site</span>') +
        (p.featured ? '<br><span class="st ok" style="margin-top:4px;display:inline-block">' +
          '\u2605 Showcase' + (p.featureSort ? ' #' + p.featureSort : '') + '</span>' : '') + '</td>' +
      '<td><button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(p.id) + '">Edit</button></td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="9" style="padding:22px;color:var(--muted)">Nothing matches.</td></tr>';

  paintBulk();
  /* Counted by the database over the whole catalogue, not over the page. */
  $('#kLive').textContent = STATS.onSite == null ? '—' : STATS.onSite;
  $('#kSearch').textContent = STATS.searchOnly == null ? '—' : STATS.searchOnly;
  $('#kHidden').textContent = STATS.hidden == null ? '—' : STATS.hidden;
  $('#kFree').textContent = STATS.zeroTuition == null ? '—' : STATS.zeroTuition;
}

function paintDests() {
  $('#nDest').textContent = DESTS.length;
  $('#kDest').textContent = DESTS.filter(d => d.active).length;
  $('#destRows').innerHTML = DESTS.map(d =>
    '<tr><td style="font-size:15px">' + (d.flag || '🌍') + ' <b style="font-size:13.6px">' + esc(d.name) + '</b>' +
      (d.region ? '<br><span style="font-size:11.6px;color:var(--muted)">' + esc(d.region) + '</span>' : '') + '</td>' +
    '<td><code>' + esc(d.code) + '</code></td>' +
    '<td>' + d.programmes + '</td>' +
    '<td>' + (d.active ? '<span class="st ok">Shown</span>' : '<span class="st wait">Hidden</span>') + '</td>' +
    /* How complete the requirements are, as a count. A destination showing 0 of
       8 is one where the finder's Requirements panel is nearly empty, and that
       is a thing to notice from the list rather than by opening each one. */
    '<td>' + (() => {
      const f = d.facts || {};
      const filled = [f.minCgpaPublic, f.minCgpaPrivate, f.degreeRule, f.fundsInr,
        f.livingInr, f.workRights, (f.tests || []).length, (f.documents || []).length]
        .filter(Boolean).length;
      return '<button type="button" class="btn btn-ghost btn-sm" data-dreq="' + esc(d.code) + '">' +
        (filled === 8 ? 'All 8 filled in' : filled + ' of 8 filled in') + '</button>';
    })() + '</td>' +
    '<td><button type="button" class="btn btn-ghost btn-sm" data-dtoggle="' + esc(d.code) + '">' +
      (d.active ? 'Hide' : 'Show') + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-ddel="' + esc(d.code) +
      '" style="margin-left:7px">Remove</button></td></tr>').join('');

  const keep = $('#fc').value;
  $('#fc').innerHTML = '<option value="">Every destination</option>' +
    DESTS.map(d => '<option value="' + esc(d.code) + '">' + (d.flag || '') + ' ' + esc(d.name) + '</option>').join('');
  $('#fc').value = keep;
  const keepD = $('#dlCountry').value;
  $('#dlCountry').innerHTML = '<option value="">The whole catalogue</option>' +
    DESTS.map(d => '<option value="' + esc(d.code) + '">' + (d.flag || '') + ' ' + esc(d.name)
      + ' (' + d.programmes + ')</option>').join('');
  $('#dlCountry').value = keepD;

  /* The field list is built from the catalogue rather than written down, so a
     field can never appear in the filter with nothing behind it — and a new
     one somebody types into a programme shows up here without a developer. */
  const keepF = $('#ff').value;
  $('#ff').innerHTML = '<option value="">Any field</option>' +
    FIELDS.map(f => '<option value="' + esc(f.field) + '">' + esc(f.field) + ' (' + f.n + ')</option>').join('');
  $('#ff').value = keepF;
}

function paintLog() {
  $('#logRows').innerHTML = LOG.map(a =>
    '<li>' + ico('check') + '<span style="flex:1">' + esc(a.what) +
    (a.detail ? ' — <span style="color:var(--muted)">' + esc(a.detail) + '</span>' : '') + '</span>' +
    '<span class="st none" style="text-transform:none;letter-spacing:0">' + esc(a.who) + ' · ' +
    timeAgo(a.at) + '</span></li>').join('') ||
    '<li><span>Nothing has been changed yet.</span></li>';
}

/* ------------------------------------------------------------------ editor */

function field(label, id, value, attrs, help) {
  return '<div class="field" style="margin-bottom:13px"><label for="' + id + '">' + esc(label) + '</label>' +
    '<input id="' + id + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '>' +
    (help ? '<p style="margin:6px 0 0;font-size:11.6px;color:var(--muted);line-height:1.5">' + help + '</p>' : '') +
    '</div>';
}
function select(label, id, value, opts, help) {
  return '<div class="field" style="margin-bottom:13px"><label for="' + id + '">' + esc(label) + '</label>' +
    '<select id="' + id + '">' + opts.map(([v, t]) =>
      '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' +
      esc(t) + '</option>').join('') + '</select>' +
    (help ? '<p style="margin:6px 0 0;font-size:11.6px;color:var(--muted);line-height:1.5">' + help + '</p>' : '') +
    '</div>';
}

function openEditor(p) {
  editing = p || null;
  const v = p || {isPublic: true, active: true, intakes: [{season: 'winter', deadline: ''}]};
  /* Whether the person editing has made their own choice about how a student
     applies. Until they do, that answer FOLLOWS the university type — see the
     handler under the form. */
  feeTouched = false;
  $('#pmTitle').textContent = p ? 'Edit programme' : 'Add a programme';
  $('#pmLead').textContent = p
    ? 'Changes are on the home page finder as soon as you save.'
    : 'It appears on the home page finder as soon as you save.';
  $('#pmDelete').style.display = p ? '' : 'none';
  $('#pmErr').style.display = 'none';

  const ins = (v.intakes && v.intakes.length ? v.intakes : [{season: 'winter', deadline: ''}]).slice(0, 3);

  $('#pmBody').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">' +
      field('Programme name', 'fProgram', v.program, 'placeholder="MSc Data Science"') +
      field('University', 'fUni', v.university, 'placeholder="University of Melbourne"') +
      select('Destination', 'fCountry', v.country,
        [['', 'Choose…']].concat(DESTS.filter(d => d.active).map(d => [d.code, (d.flag || '') + ' ' + d.name]))) +
      field('City', 'fCity', v.city, 'placeholder="Melbourne"') +
      select('Level', 'fLevel', v.level, LEVELS) +
      field('Field', 'fField', v.field, 'placeholder="Data Science &amp; AI"',
        'Groups it in the finder&rsquo;s field chips.') +
      select('University type', 'fPublic', v.isPublic ? '1' : '0',
        [['1', 'Public'], ['0', 'Private']],
        'Public means the tuition-free track, and it is what the finder gates behind a package.') +
      select('How the student applies', 'fFee',
        (v.feeModel === 'free' || v.feeModel === 'package')
          ? v.feeModel : (v.isPublic ? 'package' : 'free'),
        [['free', 'Fast-track — free (we are partnered)'],
         ['package', 'Comprehensive filing (we are not)']],
        'What applying through us costs THEM. This is what the student filters on, ' +
        'because public-versus-private only means something in Germany. Mark a ' +
        'university free the day the partnership is signed &mdash; here, or in the ' +
        '<b>application</b> column of the catalogue sheet.') +
      field('Total tuition, ₹', 'fTuition', v.totalInr || 0, 'type="number" min="0" step="1000"',
        'Whole course, in rupees. <b>0 means no tuition</b> — that is load-bearing on the site.') +
      select('Budget band', 'fBand', v.band, BANDS,
        'Leave it on the first option and it is worked out from the fee.') +
      field('Minimum CGPA', 'fCgpa', v.minCgpa == null ? '' : v.minCgpa,
        'type="number" min="0" max="10" step="0.1" placeholder="7.5"',
        'On 10, for THIS programme. <b>Leave it empty</b> and the destination&rsquo;s ' +
        'own rule applies &mdash; which is right for most rows. Fill it in where a ' +
        'university asks for more or less than its country normally does, and the ' +
        'finder will use this number instead.') +
      field('German grade asked for', 'fGgpa', v.germanGpa == null ? '' : v.germanGpa,
        'type="number" min="1" max="4" step="0.1" placeholder="2.5"',
        '<b>1.0 is the best grade, 4.0 is the pass</b> &mdash; the opposite way ' +
        'round to a CGPA. This is the German scale and it is only meaningful on ' +
        'a German row. Leave it empty where the university has not published ' +
        'one. Do <b>not</b> put a German grade in the CGPA box above: 2.5 there ' +
        'reads as &ldquo;asks for 2.5 out of 10&rdquo; and lets every applicant ' +
        'through.') +
      field('Fit score', 'fFit', v.fit || 0,
        'type="number" min="0" max="100" step="1" placeholder="80"',
        'How realistic this is for a typical applicant, 0&ndash;100. It orders the ' +
        'matched shortlists and breaks ties in the finder.') +
      field('Course page', 'fUrl', v.url, 'placeholder="https://…"',
        'Must start with http. Students click through to it.') +
    '</div>' +
    '<h3 style="font-size:14px;margin:6px 0 10px">Application deadlines</h3>' +
    /* "The system accepts a previous date."
     *
     * It does, and that is now deliberate rather than an oversight — but only
     * because it was made deliberate, and nothing on this form said so. An
     * intake is annual: the day and the month are read and the year is worked
     * out from today, so a date from a cycle that has ended reads as the next
     * one and nothing on the site can show a deadline in the past. Which is
     * exactly what makes a silent form the wrong answer here — a counsellor
     * typing 2026 and seeing it accepted has no way to tell whether the site
     * will honour the year or ignore it. */
    '<p style="margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#f2f6fd;' +
      'border:1px solid #cddcf3;font:400 12.3px/1.6 var(--sans);color:var(--navy-800)">' +
      '<b>The year is not used.</b> An intake repeats every year, so only the ' +
      'day and the month are read from here &mdash; the site works out which ' +
      'year from today\'s date. A date from a cycle that has ended is fine and ' +
      'reads as the next one.</p>' +
    '<div id="intakes">' + ins.map((i, n) =>
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:10px">' +
      select('Intake ' + (n + 1), 'fSeason' + n, i.season,
        [['winter', 'Winter'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['spring', 'Spring']]) +
      field('Closes', 'fDeadline' + n, i.deadline, 'type="date"') + '</div>').join('') +
    '</div>' +
    /* Three places a programme can be, not two. "Search only" is what a
       catalogue of a hundred thousand rows is mostly made of: a page for
       Google and the search box, and nothing on the home page. */
    '<label style="display:block;font:600 13px/1.4 var(--sans);color:var(--navy-800);margin-top:8px">' +
      'Where it shows' +
      '<select id="fWhere" style="display:block;width:100%;margin-top:5px;padding:9px 11px;' +
        'font:600 12.8px/1.4 var(--sans);border:1.5px solid #d8dde4;border-radius:9px">' +
        '<option value="site"' + (v.active !== false && !v.searchOnly ? ' selected' : '') +
          '>On the site — finder, lists and its own page</option>' +
        '<option value="search"' + (v.active !== false && v.searchOnly ? ' selected' : '') +
          '>Search only — its page and the search box, not the home page</option>' +
        '<option value="hidden"' + (v.active === false ? ' selected' : '') + '>Hidden</option>' +
      '</select></label>' +
    /* Where it sits in the grid on the home page. Separate from "show this on
       the website", because everything on the site is in the finder and only a
       handful lead the showcase. */
    '<h3 style="font-size:14px;margin:18px 0 4px">The showcase on the home page</h3>' +
    '<p style="margin:0 0 10px;font-size:11.8px;color:var(--muted);line-height:1.5">' +
      'The grid under &ldquo;Real universities, matched to what you&rsquo;re looking for&rdquo;. ' +
      'Featured programmes lead it, in the order you number them; everything else follows ' +
      'cheapest first.</p>' +
    '<label style="display:flex;gap:9px;align-items:center;font:600 13px/1.4 var(--sans);' +
      'color:var(--navy-800);margin-bottom:10px">' +
      '<input type="checkbox" id="fFeatured"' + (v.featured ? ' checked' : '') + '> ' +
      'Feature this one</label>' +
    '<div style="max-width:220px">' +
      field('Position', 'fFeatureSort', v.featureSort || 0, 'type="number" min="0" max="999"',
        '1 shows first. Leave at 0 and it follows the other featured ones.') +
    '</div>';

  $('#progModal').classList.add('on');
  setTimeout(() => $('#fProgram').focus(), 50);
}

function readEditor() {
  const intakes = [];
  for (let n = 0; n < 3; n++) {
    const d = $('#fDeadline' + n);
    if (d && d.value) intakes.push({season: $('#fSeason' + n).value, deadline: d.value});
  }
  return {
    id: editing ? editing.id : '',
    program: $('#fProgram').value,
    university: $('#fUni').value,
    city: $('#fCity').value,
    country: $('#fCountry').value,
    level: $('#fLevel').value,
    field: $('#fField').value,
    band: $('#fBand').value,
    isPublic: $('#fPublic').value === '1',
    feeModel: $('#fFee').value === 'free' ? 'free' : 'package',
    featured: $('#fFeatured').checked,
    featureSort: Number($('#fFeatureSort').value || 0),
    totalInr: Number($('#fTuition').value || 0),
    /* Empty stays empty — it means "follow the destination's rule", and
       sending 0 would mean "takes anybody". */
    minCgpa: $('#fCgpa').value.trim() === '' ? null : Number($('#fCgpa').value),
    /* Same rule, opposite scale. Empty means the university has not published
       one; 0 would mean better than the best grade that exists, so nobody
       qualifies. */
    germanGpa: $('#fGgpa').value.trim() === '' ? null : Number($('#fGgpa').value),
    fit: Number($('#fFit').value || 0),
    url: $('#fUrl').value.trim(),
    active: $('#fWhere').value !== 'hidden',
    searchOnly: $('#fWhere').value === 'search',
    intakes,
  };
}

/* ------------------------------------------------------------ spreadsheet */
/*
 * Two passes, always. The first reads the file and answers "what would this
 * do"; the second does it. The endpoint enforces that — it writes nothing
 * without `confirm` — but the screen has to make the plan legible, because a
 * confirm button under a summary nobody can read is the same as no confirm
 * button at all.
 */

let sheetPlan = null;

async function sheetPost(fields) {
  const f = $('#sFile').files[0];
  if (!f) throw new Error('Choose a file first.');
  const fd = new FormData();
  fd.append('file', f, f.name);
  Object.keys(fields || {}).forEach(k => fd.append(k, fields[k]));
  const r = await fetch('/api/staff/catalogue/import',
    {method: 'POST', credentials: 'same-origin', body: fd});
  if (r.status === 401) { location.href = 'login.html'; throw new Error('signed out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.data = data; throw e; }
  return data;
}

function rowList(items, render) {
  const shown = items.slice(0, 12).map(render).join('');
  const more = items.length > 12
    ? '<li style="color:var(--muted)"><span>&hellip; and ' + (items.length - 12) + ' more</span></li>' : '';
  return '<ul class="doclist" style="margin:10px 0 0">' + shown + more + '</ul>';
}

function paintPlan(d) {
  const p = d.plan || {}, c = d.counts || {};
  const box = (n, label, tone) =>
    '<div><b style="color:' + tone + '">' + n + '</b><span>' + label + '</span></div>';

  let html =
    '<div class="out tiles" style="--tiles:4;margin:0">' +
      box(c.create || 0, 'to add', 'var(--navy-900)') +
      box(c.update || 0, 'to change', 'var(--navy-900)') +
      box(c.unchanged || 0, 'already right', 'var(--muted)') +
      box(c.rejected || 0, 'cannot import', (c.rejected ? '#a5311f' : 'var(--muted)')) +
    '</div>';

  if (c.warned) {
    html += '<p style="margin:14px 0 0;padding:11px 13px;border-radius:10px;background:#fffaf0;' +
      'border:1px solid #f0dcb4;font:600 12.6px/1.55 var(--sans);color:#7a5510">' +
      c.warned + ' row' + (c.warned === 1 ? ' has' : 's have') + ' a word that could not be ' +
      'matched &mdash; the level, the budget band or an intake season. Those rows still import; ' +
      'the note under each one says what will happen to it.</p>';
  }

  /* What the importer did that nobody asked it to. Said once, at the top,
     rather than on each of a hundred rows — the year in a deadline is not
     used, and a counsellor uploading last cycle's dates should be told that
     on purpose rather than left to infer it from the site not complaining. */
  if ((p.notes || []).length) {
    html += p.notes.map(n =>
      '<p style="margin:14px 0 0;padding:11px 13px;border-radius:10px;background:#f2f6fd;' +
      'border:1px solid #cddcf3;font:400 12.6px/1.6 var(--sans);color:var(--navy-800)">' +
      esc(n) + '</p>').join('');
  }

  if ((p.unknownColumns || []).length) {
    html += '<p style="margin:14px 0 0;padding:11px 13px;border-radius:10px;background:#fffaf0;' +
      'border:1px solid #f0dcb4;font:600 12.6px/1.55 var(--sans);color:#7a5510">' +
      'Columns that were not recognised and were left alone: ' +
      p.unknownColumns.map(esc).join(', ') + '</p>';
  }

  if ((p.rejected || []).length) {
    html += '<h3 style="font-size:13.6px;margin:20px 0 0">Rows that cannot be imported</h3>' +
      rowList(p.rejected, r =>
        '<li><span style="flex:1"><b>Row ' + r.line + '</b> &mdash; ' + esc(r.what || '(blank)') +
        '<br><span style="font-size:11.8px;color:#a5311f">' + r.why.map(esc).join('; ') +
        '</span></span></li>');
  }
  /* A warning is a row that WILL be imported, with a word in it that could not
     be translated. It is shown under the row it belongs to, in the colour of a
     caution rather than an error, because the counsellor's decision is
     "correct the sheet or accept it" — not "fix this before anything happens". */
  const warnLine = r => ((r.warn || []).length
    ? '<br><span style="font-size:11.8px;color:#7a5510">' + r.warn.map(esc).join('; ') + '</span>'
    : '');

  if ((p.create || []).length) {
    html += '<h3 style="font-size:13.6px;margin:20px 0 0">New programmes</h3>' +
      rowList(p.create, r => '<li><span style="flex:1"><b>Row ' + r.line + '</b> &mdash; ' +
        esc(r.what) + warnLine(r) + '</span></li>');
  }
  if ((p.update || []).length) {
    html += '<h3 style="font-size:13.6px;margin:20px 0 0">Changes</h3>' +
      rowList(p.update, r => '<li><span style="flex:1"><b>Row ' + r.line + '</b> &mdash; ' +
        esc(r.what) + '<br><span style="font-size:11.8px;color:var(--muted)">' +
        r.changed.map(esc).join(', ') + '</span>' + warnLine(r) + '</span></li>');
  }

  /* A row that changes nothing can still carry a warning, and this screen used
     to swallow it: somebody typing a German grade of 25 into a row that had no
     bar gets no change, and was told nothing at all. */
  const quietWarn = (p.unchanged || []).filter(r => (r.warn || []).length);
  if (quietWarn.length) {
    html += '<h3 style="font-size:13.6px;margin:20px 0 0">Rows that change nothing, '
      + 'but are worth a look</h3>' +
      rowList(quietWarn, r => '<li><span style="flex:1"><b>Row ' + r.line + '</b> &mdash; ' +
        esc(r.what || '') + warnLine(r) + '</span></li>');
  }

  const willWrite = (c.create || 0) + (c.update || 0);
  if (!willWrite && !(c.rejected || 0)) {
    html += '<p style="margin:18px 0 0;font:600 13px/1.5 var(--sans)">' +
      'That sheet matches what is already on the site. There is nothing to apply.</p>';
  } else if (willWrite) {
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:20px;' +
      'padding-top:18px;border-top:1px solid var(--line)">' +
      '<button type="button" class="btn btn-primary" id="sApply">Apply ' + willWrite +
        ' change' + (willWrite === 1 ? '' : 's') + '</button>' +
      '<button type="button" class="btn btn-ghost" id="sCancel">Cancel</button>' +
      ((c.rejected || 0)
        ? '<span style="font:600 12.4px/1.5 var(--sans);color:var(--muted)">The ' + c.rejected +
          ' row' + (c.rejected === 1 ? '' : 's') + ' above will be skipped.</span>'
        : '') +
      '</div>';
  } else {
    html += '<p style="margin:18px 0 0;font:600 13px/1.5 var(--sans);color:#a5311f">' +
      'Nothing in that sheet can be imported. Fix the rows above and upload it again.</p>';
  }

  sheetPlan = d;
  $('#sOut').innerHTML = html;
}

/* ------------------------------------------------------------------ bulk */

function paintBulk() {
  const n = PICKED.size;
  /* Not the `hidden` attribute: this card carries an inline display, and an
     inline display beats the stylesheet rule behind `hidden`, so the bar would
     sit there permanently offering to delete things. */
  $('#bulkBar').style.display = n ? 'flex' : 'none';
  $('#bulkCount').textContent = n + ' selected' + (PICK_CAPPED && n >= 2000 ? ' (the first 2,000 of ' + PICK_CAPPED.toLocaleString('en-IN') + ')' : '');
  const all = $('#selAll');
  const shownPicked = SHOWN.filter(id => PICKED.has(id)).length;
  all.checked = SHOWN.length > 0 && shownPicked === SHOWN.length;
  /* Part of the search is ticked: neither box nor blank, which is the honest
     state and the one that stops "select all" reading as "you have them all". */
  all.indeterminate = shownPicked > 0 && shownPicked < SHOWN.length;
}

async function bulkDo(action, verb) {
  const ids = [...PICKED];
  if (!ids.length) return;

  /* The confirmation names the number and the action. Removal is the only one
     that cannot be undone from this screen, so it is the only one that asks. */
  if (action === 'delete') {
    const msg = ids.length + (ids.length === 1 ? ' programme' : ' programmes')
      + ' will be removed from the catalogue.\n\nAnything a student has shortlisted or '
      + 'applied to is taken off the site instead of removed, so their application does not '
      + 'blank out. This cannot be undone from here.';
    if (!confirm(msg)) return;
  }

  try {
    const r = await api('POST', '/api/staff/programmes/bulk', {ids, action});
    PICKED.clear(); PICK_CAPPED = 0;
    await reload();
    const bits = [];
    if (r.deleted) bits.push(r.deleted + ' removed');
    if (r.hidden) bits.push(r.hidden + ' taken off the site');
    if (r.shown) bits.push(r.shown + ' put back on the site');
    if (r.searchOnly) bits.push(r.searchOnly + ' made search only');
    if (r.missing) bits.push(r.missing + ' already gone');
    toast(bits.join(', ') || 'Nothing to do.');
    if (action === 'delete' && r.keptNames && r.keptNames.length) {
      alert('Kept, because a student has these shortlisted or has applied — they were taken '
        + 'off the site instead:\n\n' + r.keptNames.join('\n'));
    }
  } catch (err) { toast(err.message); }
}

async function reload() {
  await fetchProgs();
  loadUnis().catch(() => {});
}

/* ------------------------------------------------------ university pages */

let UNIS = [], UNI_TOTAL = 0, uniOpen = null, uniDirty = false;

/* The list is a page of the database, searched there: the box on the left
   asks for the universities whose name, short name or city has the words. */
let uniReq = 0, uniTimer = null;
async function loadUnis() {
  const q = ($('#uq').value || '').trim();
  const mine = ++uniReq;
  const r = await api('GET', '/api/staff/universities?page=' + (pageOf('uni') + 1)
    + '&per=' + sizeOf('uni') + (q ? '&q=' + encodeURIComponent(q) : ''));
  if (mine !== uniReq) return;
  UNIS = r.universities; UNI_TOTAL = r.total;
  PAGE_AT.uni = Math.max(0, (r.page || 1) - 1);
  $('#nPages').textContent = UNI_TOTAL;
  paintUnis();
}
function loadUnisSoon() {
  clearTimeout(uniTimer);
  uniTimer = setTimeout(() => { loadUnis().catch(err => toast(err.message)); }, 220);
}

function paintUnis() {
  const rows = UNIS;
  $('#uniPager').innerHTML = pagerHtml('uni', UNI_TOTAL, 'universities', () => { loadUnis().catch(err => toast(err.message)); });
  const dest = code => (DESTS.find(d => d.code === code) || {}).name || code;
  $('#uniList').innerHTML = rows.map(u =>
    '<li data-uni="' + esc(u.slug) + '"' + (u.slug === uniOpen ? ' class="on"' : '') + '>'
    + '<b>' + esc(u.name) + '</b><span>' + esc(dest(u.country)) + (u.city ? ' · ' + esc(u.city) : '')
    + ' · ' + u.programmes + ' programme' + (u.programmes === 1 ? '' : 's')
    + (u.daadUrl ? ' · DAAD' : '')
    + (u.listed ? '' : ' · search only')
    + (u.hidden ? ' · <span style="color:#7a2118;font-weight:700">off search</span>'
      : u.written ? ' · <span class="w">written</span>' : '') + '</span></li>').join('')
    || '<li><span>Nothing matches.</span></li>';
}

function uniCount(id, n, limit, low) {
  const el = $('#' + id);
  el.textContent = n + ' / ' + limit;
  el.className = 'cnt' + (n > limit ? ' over' : '');
}

async function openUni(slug) {
  if (uniDirty && !confirm('You have unsaved changes on this page. Leave them?')) return;
  const r = await api('GET', '/api/staff/university/' + slug);
  uniOpen = slug; uniDirty = false;
  paintUnis();
  const u = r.university, x = r.extras;
  const thumb = url => url ? '<img src="' + esc(url) + '" alt="">' : '<div class="nopic">No picture</div>';
  $('#uniEd').innerHTML =
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">'
    + '<h3 style="margin:0">' + esc(u.name) + '</h3>'
    + '<a class="btn btn-ghost btn-sm" href="' + esc('/university/' + u.slug) + '" target="_blank" rel="noopener">'
    + 'Open the page ↗</a>'
    + '<span style="font-size:12px;color:var(--muted)">' + u.programmes + ' programme'
    + (u.programmes === 1 ? '' : 's') + ' on it</span></div>'

    + '<div class="field"><label for="uAbout">About the university '
    + '<small style="font-weight:400;color:var(--muted)">— what a student should know that the fee table does not say. '
    + 'Same box as the blog: <code>## Heading</code>, <code>- item</code>, <code>**bold**</code>.</small>'
    + '<span class="cnt" id="cAbout">0 / 6000</span></label>'
    + '<textarea id="uAbout" placeholder="Where it is, what it is known for, what the campus and the city are like, '
    + 'what our students say about it…">' + esc(x.about) + '</textarea></div>'

    + '<div class="field"><label for="uCover">Picture <small style="font-weight:400;color:var(--muted)">'
    + '— shown at the top of the page and in the link preview. Optional.</small></label>'
    + '<div class="coverrow"><div id="uCoverPrev">' + thumb(x.cover) + '</div><div>'
    + '<input id="uCover" value="' + esc(x.cover) + '" placeholder="/images/… — or upload one">'
    + '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">'
    + '<button type="button" class="btn btn-ghost btn-sm" id="uCoverUp">Upload a picture</button>'
    + '<button type="button" class="btn btn-ghost btn-sm" id="uCoverClear">Remove</button>'
    + '<input type="file" id="uCoverFile" accept="image/jpeg,image/png,image/gif,image/webp" hidden>'
    + '</div></div></div></div>'

    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" class="two">'
    + '<div class="field"><label for="uMetaTitle">Title for search '
    + '<small style="font-weight:400;color:var(--muted)">— empty uses “' + esc(u.name) + ' — courses, fees &amp; deadlines”</small>'
    + '<span class="cnt" id="cMetaTitle">0 / 65</span></label>'
    + '<input id="uMetaTitle" value="' + esc(x.metaTitle) + '"></div>'
    + '<div class="field"><label for="uMetaDesc">The sentence under it '
    + '<span class="cnt" id="cMetaDesc">0 / 165</span></label>'
    + '<input id="uMetaDesc" value="' + esc(x.metaDesc) + '"></div></div>'

    + '<div class="field"><label for="uDaad">DAAD '
    + '<small style="font-weight:400;color:var(--muted)">— the institution number from the DAAD International '
    + 'Programmes search (the <code>ins</code> in its address), or a daad.de link. German universities '
    + 'we ship already have one; typing here replaces it.</small></label>'
    + '<input id="uDaad" value="' + esc(x.daad) + '" placeholder="248">'
    + (r.daadUrl ? '<p style="margin:6px 0 0;font-size:11.6px;color:var(--muted)">The page links to '
      + '<a href="' + esc(r.daadUrl) + '" target="_blank" rel="noopener">' + esc(r.daadUrl) + '</a></p>'
      : '<p style="margin:6px 0 0;font-size:11.6px;color:var(--muted)">No DAAD link on this page — '
      + 'the DAAD lists German universities only.</p>') + '</div>'

    + '<label style="display:flex;gap:8px;align-items:center;font:400 13px/1.5 var(--sans);margin:4px 0 16px">'
    + '<input type="checkbox" id="uHidden" style="width:auto"' + (x.hidden ? ' checked' : '') + '> '
    + 'Keep this page out of search engines and off the list (the page still opens by its address)</label>'

    + '<p id="uErr" role="alert" style="display:none;margin:0 0 12px;padding:11px 13px;border-radius:10px;'
    + 'font:600 12.9px/1.55 var(--sans);background:#fdf3f2;border:1px solid #f0c8c4;color:#7a2118"></p>'
    + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
    + '<button type="button" class="btn btn-primary" id="uSave">Save</button>'
    + '<span id="uSaid" style="font:600 12.6px/1.5 var(--sans);color:#14603a"></span></div>';

  const counts = () => {
    uniCount('cAbout', $('#uAbout').value.length, 6000, 0);
    uniCount('cMetaTitle', $('#uMetaTitle').value.trim().length, 65, 0);
    uniCount('cMetaDesc', $('#uMetaDesc').value.trim().length, 165, 0);
  };
  counts();
  ['uAbout', 'uCover', 'uMetaTitle', 'uMetaDesc', 'uDaad'].forEach(id =>
    $('#' + id).addEventListener('input', () => { uniDirty = true; counts(); }));
  $('#uHidden').addEventListener('change', () => { uniDirty = true; });
  $('#uCover').addEventListener('input', () => { $('#uCoverPrev').innerHTML = thumb($('#uCover').value.trim()); });
  $('#uCoverClear').onclick = () => { $('#uCover').value = ''; $('#uCoverPrev').innerHTML = thumb(''); uniDirty = true; };
  $('#uCoverUp').onclick = () => { $('#uCoverFile').value = ''; $('#uCoverFile').click(); };
  $('#uCoverFile').onchange = async () => {
    const f = $('#uCoverFile').files && $('#uCoverFile').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f, f.name || 'picture');
    try {
      const r2 = await fetch('/api/staff/images', { method: 'POST', credentials: 'same-origin', body: fd });
      const d = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(d.error || ('HTTP ' + r2.status));
      $('#uCover').value = d.image.url;
      $('#uCoverPrev').innerHTML = thumb(d.image.url);
      uniDirty = true;
    } catch (e) { $('#uErr').textContent = e.message; $('#uErr').style.display = 'block'; }
  };
  $('#uSave').onclick = async () => {
    const err = $('#uErr'); err.style.display = 'none';
    $('#uSave').disabled = true;
    try {
      await api('PUT', '/api/staff/university/' + slug, {
        about: $('#uAbout').value, cover: $('#uCover').value.trim(),
        metaTitle: $('#uMetaTitle').value.trim(), metaDesc: $('#uMetaDesc').value.trim(),
        daad: $('#uDaad').value.trim(),
        hidden: $('#uHidden').checked,
      });
      uniDirty = false;
      $('#uSaid').textContent = 'Saved — it is on the page now.';
      setTimeout(() => { if ($('#uSaid')) $('#uSaid').textContent = ''; }, 5000);
      await loadUnis();
    } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
    $('#uSave').disabled = false;
  };
}

/* ------------------------------------------------- entry requirements */
/*
 * What a student reads before deciding whether they qualify, and how much money
 * they have to show. It changes every year and differs per country, which is
 * exactly the kind of thing that must not need a developer.
 */
function openReqEditor(code) {
  const d = DESTS.find(x => x.code === code);
  if (!d) return;
  const f = d.facts || {};
  const num = (label, id, v, hint, step) =>
    '<div class="field" style="margin-bottom:11px"><label for="' + id + '">' + esc(label) + '</label>' +
    '<input id="' + id + '" type="number" min="0" step="' + (step || '1') + '" value="' +
    esc(v || '') + '">' +
    (hint ? '<span style="display:block;margin-top:4px;font-size:11.6px;color:var(--muted);' +
      'line-height:1.5">' + hint + '</span>' : '') + '</div>';
  const txt = (label, id, v, hint, rows) =>
    '<div class="field" style="margin-bottom:11px"><label for="' + id + '">' + esc(label) + '</label>' +
    '<textarea id="' + id + '" rows="' + (rows || 2) + '" style="width:100%;padding:9px 11px;' +
    'font:400 13px/1.55 var(--sans);border:1.5px solid #d8dde4;border-radius:9px;resize:vertical">' +
    esc(v || '') + '</textarea>' +
    (hint ? '<span style="display:block;margin-top:4px;font-size:11.6px;color:var(--muted);' +
      'line-height:1.5">' + hint + '</span>' : '') + '</div>';

  $('#pmTitle').textContent = 'Entry requirements — ' + d.name;
  $('#pmLead').textContent = 'This is the Requirements panel a student opens in the finder. '
    + 'Anything left blank is left off that panel rather than shown empty.';
  $('#pmBody').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">' +
      num('Minimum CGPA — public universities', 'rCgP', f.minCgpaPublic,
        'On 10. Leave 0 if there is no public track here.', '0.1') +
      num('Minimum CGPA — private universities', 'rCgV', f.minCgpaPrivate, 'On 10.', '0.1') +
    '</div>' +
    txt('The degree rule', 'rDeg', f.degreeRule,
      'e.g. 4-year Bachelor. A 3-year degree needs a recognised bridge.') +
    txt('Backlogs', 'rBack', f.backlogRule) +
    txt('Tests accepted', 'rTests', (f.tests || []).join('\n'),
      'One per line. These are shown as their own lines in the panel.', 3) +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">' +
      '<div class="field" style="margin-bottom:11px"><label for="rFundsL">What the funds are called' +
        '</label><input id="rFundsL" value="' + esc(f.fundsLabel || '') +
        '" placeholder="Blocked account"></div>' +
      num('Funds to show, \u20b9', 'rFunds', f.fundsInr, 'In rupees. The whole figure.') +
    '</div>' +
    txt('A note about the funds', 'rFundsN', f.fundsNote) +
    num('Living costs a month, \u20b9', 'rLiving', f.livingInr) +
    txt('Work rights', 'rWork', f.workRights) +
    txt('Deadlines', 'rDead', f.deadlineNote) +
    txt('Anything else', 'rExtra', f.extraNote,
      'The one thing people get caught out by. Germany\u2019s is the APS certificate.') +
    txt('Documents', 'rDocs', (f.documents || []).join('\n'), 'One per line.', 4) +
    '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:4px">' +
      '<label style="display:flex;gap:8px;align-items:center;font:600 12.8px/1.4 var(--sans)">' +
        '<input type="checkbox" id="rPublic"' + (f.hasPublicTrack ? ' checked' : '') +
        '> Has a public-university track</label>' +
      '<label style="display:flex;gap:8px;align-items:center;font:600 12.8px/1.4 var(--sans)">' +
        '<input type="checkbox" id="rFree"' + (f.tuitionFree ? ' checked' : '') +
        '> Public tuition is free</label>' +
    '</div>' +
    '<p style="margin:14px 0 0;font-size:11.8px;color:var(--muted);line-height:1.6">' +
      'Requirements move every intake. What you save here is what a student reads before ' +
      'deciding to pay, so it is worth checking against the official source rather than ' +
      'against last year\u2019s page.</p>';

  editing = {reqFor: code};
  $('#pmDelete').style.display = 'none';
  $('#pmErr').style.display = 'none';
  $('#progModal').classList.add('on');
}

function reqFromForm() {
  const v = id => { const el = $('#' + id); return el ? el.value.trim() : ''; };
  return {
    minCgpaPublic: v('rCgP'), minCgpaPrivate: v('rCgV'),
    degreeRule: v('rDeg'), backlogRule: v('rBack'),
    tests: v('rTests').split('\n').map(x => x.trim()).filter(Boolean),
    fundsLabel: v('rFundsL'), fundsInr: v('rFunds'), fundsNote: v('rFundsN'),
    livingInr: v('rLiving'), workRights: v('rWork'), deadlineNote: v('rDead'),
    extraNote: v('rExtra'),
    documents: v('rDocs').split('\n').map(x => x.trim()).filter(Boolean),
    hasPublicTrack: $('#rPublic') ? $('#rPublic').checked : false,
    tuitionFree: $('#rFree') ? $('#rFree').checked : false,
  };
}

/* --------------------------------------------------------------- behaviour */

/* Private, and then filed under packages anyway.
 *
 * "When I enter the University as Private, in the front end it shows the
 *  university under Select a package."
 *
 * Two controls, coupled and not moving together. A new programme opens as
 * PUBLIC — Germany's tuition-free track is the business — and "How the student
 * applies" therefore opens on Comprehensive filing. Change the type to Private
 * and the second answer stayed where it was, so a private university went onto
 * the site gated behind a package it has no business being behind. Nothing on
 * the form said so; the counsellor changed the one thing they were asked about
 * and the wrong one was left behind them.
 *
 * So the second answer FOLLOWS the first until somebody sets it themselves.
 * `feeTouched` is what makes that safe: a deliberate choice — a private
 * university we are not partnered with, which is a real thing — is never
 * overwritten by changing the type afterwards. */
document.addEventListener('input', e => {
  if (e.target && e.target.id === 'uq') { PAGE_AT.uni = 0; loadUnisSoon(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'fFee') feeTouched = true;
  if (e.target.id === 'fPublic' && !feeTouched) {
    const fee = document.querySelector('#fFee');
    if (fee) fee.value = e.target.value === '1' ? 'package' : 'free';
  }

  const box = e.target.closest('[data-pick]');
  if (box) {
    box.checked ? PICKED.add(box.dataset.pick) : PICKED.delete(box.dataset.pick);
    const row = box.closest('tr');
    if (row) row.style.background = box.checked ? '#f4f7fb' : '';
    paintBulk();
    return;
  }
  if (e.target.id === 'selAll') {
    if (!e.target.checked) { SHOWN.forEach(id => PICKED.delete(id)); paintProgs(); return; }
    /* Everything the search found, not the page on the screen — "select
       all" that quietly means "the hundred you can see" is a trap. The
       database hands back the ids, up to the 2,000 one change can take. */
    SHOWN.forEach(id => PICKED.add(id));
    paintProgs();
    const f = progQuery();
    const qs = Object.keys(f).filter(k => f[k] !== '').map(k => k + '=' + encodeURIComponent(f[k])).join('&');
    api('GET', '/api/staff/catalogue/ids' + (qs ? '?' + qs : '')).then(r => {
      r.ids.forEach(id => PICKED.add(id));
      PICK_CAPPED = r.total > r.ids.length ? r.total : 0;
      paintProgs();
      if (PICK_CAPPED) toast('The first 2,000 of ' + r.total.toLocaleString('en-IN')
        + ' are selected — one change takes up to 2,000. Narrow the filters, or do it in turns.');
    }).catch(err => toast(err.message));
  }
});

document.addEventListener('click', async e => {
  if (e.target.closest('#bulkClear')) { PICKED.clear(); PICK_CAPPED = 0; paintProgs(); return; }
  if (e.target.closest('#bulkHide')) return bulkDo('hide');
  if (e.target.closest('#bulkShow')) return bulkDo('show');
  if (e.target.closest('#bulkSearch')) return bulkDo('search');
  if (e.target.closest('#bulkDelete')) return bulkDo('delete');

  const ul = e.target.closest('[data-uni]');
  if (ul) return openUni(ul.dataset.uni);
  const t = e.target.closest('.tab[data-t]');
  if (t) {
    $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
    $$('.pane').forEach(x => x.classList.toggle('active', x.id === 't-' + t.dataset.t));
    return;
  }
  if (e.target.closest('[data-close]') || e.target === $('#progModal')) {
    $('#progModal').classList.remove('on');
    $('#pmDelete').style.display = '';
    editing = null;
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) return openEditor(PROGS.find(p => p.id === ed.dataset.edit));
  if (e.target.closest('#addProg')) return openEditor(null);

  const req = e.target.closest('[data-dreq]');
  if (req) return openReqEditor(req.dataset.dreq);

  if (e.target.closest('#pmSave')) {
    /* The same sheet is used for a programme and for a destination's entry
       requirements, so the save has to know which one it is looking at. */
    if (editing && editing.reqFor) {
      const d = DESTS.find(x => x.code === editing.reqFor);
      $('#pmErr').style.display = 'none';
      try {
        await api('PUT', '/api/staff/country', {
          code: d.code, name: d.name, flag: d.flag, region: d.region,
          active: d.active, sort: d.sort, facts: reqFromForm(),
        });
        $('#progModal').classList.remove('on');
        $('#pmDelete').style.display = '';
        await reload();
        toast('Saved — the finder shows this to the next visitor.');
      } catch (err) {
        $('#pmErr').textContent = err.message;
        $('#pmErr').style.display = 'block';
      }
      return;
    }
    const body = readEditor();
    $('#pmErr').style.display = 'none';
    try {
      await api('PUT', '/api/staff/programme', body);
      $('#progModal').classList.remove('on');
      await reload();
      toast(editing ? 'Saved — it is live on the site.' : 'Added — it is live on the site.');
    } catch (err) {
      $('#pmErr').textContent = err.message;
      $('#pmErr').style.display = 'block';
    }
    return;
  }

  if (e.target.closest('#pmDelete') && editing) {
    try {
      const r = await api('DELETE', '/api/staff/programme/' + encodeURIComponent(editing.id));
      $('#progModal').classList.remove('on');
      await reload();
      toast(r.hidden
        ? 'Hidden. A student has it shortlisted, so it was not deleted.'
        : 'Removed from the site.');
    } catch (err) { toast(err.message); }
    return;
  }

  if (e.target.closest('#addDest')) {
    try {
      await api('PUT', '/api/staff/country', {
        code: $('#cCode').value, name: $('#cName').value,
        flag: $('#cFlag').value, region: $('#cRegion').value,
      });
      ['cCode', 'cName', 'cFlag', 'cRegion'].forEach(id => { $('#' + id).value = ''; });
      await reload();
      toast('Destination added — you can put programmes in it now.');
    } catch (err) { toast(err.message); }
    return;
  }

  const dt = e.target.closest('[data-dtoggle]');
  if (dt) {
    const d = DESTS.find(x => x.code === dt.dataset.dtoggle);
    try {
      /* Deliberately without `facts`: hiding a destination must not rewrite its
         requirements, and sending them back is how a round trip loses a field
         the form did not know about. */
      await api('PUT', '/api/staff/country', {
        code: d.code, name: d.name, flag: d.flag, region: d.region,
        sort: d.sort, active: !d.active,
      });
      await reload();
    } catch (err) { toast(err.message); }
    return;
  }

  if (e.target.closest('#sCheck')) {
    $('#sOut').innerHTML = '';
    $('#sBusy').style.display = '';
    try {
      paintPlan(await sheetPost({}));
    } catch (err) {
      $('#sOut').innerHTML = '<p role="alert" style="margin:0;padding:11px 13px;border-radius:10px;' +
        'font:600 12.8px/1.5 var(--sans);background:#fdf3f2;border:1px solid #f0c8c4;color:#7a2118">' +
        esc(err.message) + '</p>';
    } finally { $('#sBusy').style.display = 'none'; }
    return;
  }

  if (e.target.closest('#sCancel')) {
    $('#sOut').innerHTML = '';
    sheetPlan = null;
    return;
  }

  if (e.target.closest('#sApply')) {
    const btn = e.target.closest('#sApply');
    btn.disabled = true;
    btn.textContent = 'Applying…';
    try {
      /* skipBad goes up because the screen has already shown every rejected row
         and said, in words, that they will be skipped. */
      const r = await sheetPost({confirm: 'yes', skipBad: 'yes'});
      await reload();
      $('#sOut').innerHTML = '<p style="margin:0;padding:12px 14px;border-radius:10px;' +
        'font:600 13px/1.55 var(--sans);background:#f1f8f3;border:1px solid #c8e3d0;color:#1d5c33">' +
        r.created + ' added, ' + r.updated + ' updated, ' + r.unchanged + ' left alone' +
        (r.skipped ? ', ' + r.skipped + ' skipped' : '') + '. It is live on the site now.</p>';
      $('#sFile').value = '';
      sheetPlan = null;
      toast('Catalogue updated from the sheet.');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Try again';
      toast(err.message);
    }
    return;
  }

  const dd = e.target.closest('[data-ddel]');
  if (dd) {
    try {
      await api('DELETE', '/api/staff/country/' + dd.dataset.ddel);
      await reload();
      toast('Destination removed.');
    } catch (err) { toast(err.message); }
  }
});

['q', 'fc', 'fl', 'ff', 'ft', 'fb', 'fg', 'fs'].forEach(id => {
  /* A new search starts at its first page. */
  const go = () => { PAGE_AT.prog = 0; fetchProgsSoon(); };
  $('#' + id).addEventListener('input', go);
  $('#' + id).addEventListener('change', go);
});
$('#fClear').addEventListener('click', () => {
  ['fc', 'fl', 'ff', 'ft', 'fb', 'fg', 'fs'].forEach(id => { $('#' + id).value = ''; });
  $('#q').value = '';
  PAGE_AT.prog = 0;
  fetchProgsSoon();
});
/* The download links follow the destination chosen beside them. */
$('#dlCountry').addEventListener('change', () => {
  const c = $('#dlCountry').value;
  $('#dlXlsx').href = '/api/staff/catalogue.xlsx' + (c ? '?country=' + encodeURIComponent(c) : '');
  $('#dlCsv').href = '/api/staff/catalogue.csv' + (c ? '?country=' + encodeURIComponent(c) : '');
});
/* Both tables are a page of the database: a hundred rows each. */
PAGE_SIZES.prog = 100; PAGE_SIZES.uni = 100;
addEventListener('keydown', e => {
  if (e.key === 'Escape') $('#progModal').classList.remove('on');
});

/* A plan belongs to one file. Choose another and the old summary — with its
   still-live Apply button — has to go, or the button applies a file that is no
   longer the one named next to it. */
$('#sFile').addEventListener('change', () => { $('#sOut').innerHTML = ''; sheetPlan = null; });

staffBoot(async me => {
  /* The API refuses the change anyway. This is so the refusal is not the first
     thing they learn about it, after typing in fifty universities. */
  if ((me.user.perms || []).indexOf('catalogue') < 0) {
    document.querySelector('.p-main').innerHTML =
      '<div class="sl-empty" style="margin-top:40px"><b>You do not have access to the ' +
      'universities</b><p>An administrator can give it to you on the Organisation screen ' +
      '&mdash; it is a tick box beside your name.</p>' +
      '<a class="btn btn-primary" href="counsellor.html">Go to Conversations</a></div>';
    return;
  }
  await reload();
  /* Nothing here needs pushing yet, but the chip in the header claims to be
     connecting — so either connect it or do not show it. Connecting also means
     a second counsellor editing at the same time can be told about it later. */
  connectLive({});
});
"""
