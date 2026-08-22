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

    <div class="out tiles" style="--tiles:4;margin:0 0 18px">
      <div><b id="kLive">—</b><span>On the site</span></div>
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
        <select id="fs" style="padding:9px 11px;font:600 12.8px/1.4 var(--sans);
          border:1.5px solid #d8dde4;border-radius:9px">
          <option value="">On the site and hidden</option>
          <option value="1">On the site</option>
          <option value="0">Hidden only</option>
        </select>
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
            <th>Next intake</th><th>Status</th><th></th></tr></thead>
          <tbody id="progRows"></tbody>
        </table>
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
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn btn-primary" href="/api/staff/catalogue.xlsx">Download as Excel</a>
          <a class="btn btn-ghost" href="/api/staff/catalogue.csv">Download as CSV</a>
        </div>
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
        <code>no</code> in the <b>on the site</b> column.</p>
    </section>

    <!-- ------------------------------------------------------------- log -->
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
let PROGS = [], DESTS = [], LOG = [], editing = null;

/* PICKED survives a repaint and a change of search: a counsellor filters to
   Poland, ticks four, filters to Spain, ticks two, and expects six. SHOWN is
   what the current search matched — every one of them, not the 400 drawn. */
const PICKED = new Set();
let SHOWN = [];

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

/* ---------------------------------------------------------------- painting */

function paintProgs() {
  const q = $('#q').value.trim().toLowerCase();
  const c = $('#fc').value;
  const st = $('#fs').value;
  const list = PROGS.filter(p =>
    (!c || p.country === c) &&
    (st === '' || String(p.active ? 1 : 0) === st) &&
    (!q || (p.university + ' ' + p.program + ' ' + (p.field || '')).toLowerCase().includes(q)));

  $('#nProg').textContent = PROGS.length;
  /* What the tick boxes cover is what the search found, not the 400 drawn —
     "select everything" that quietly means "the first 400" is a trap. */
  SHOWN = list.map(p => p.id);
  $('#progRows').innerHTML = list.slice(0, 400).map(p => {
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
      '<td style="font-size:12.4px">' + nextIntake(p) + '</td>' +
      '<td>' + (p.active ? '<span class="st ok">On the site</span>' : '<span class="st wait">Hidden</span>') +
        (p.featured ? '<br><span class="st ok" style="margin-top:4px;display:inline-block">' +
          '\u2605 Showcase' + (p.featureSort ? ' #' + p.featureSort : '') + '</span>' : '') + '</td>' +
      '<td><button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(p.id) + '">Edit</button></td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="8" style="padding:22px;color:var(--muted)">Nothing matches.</td></tr>';

  if (list.length > 400) {
    $('#progRows').insertAdjacentHTML('beforeend',
      '<tr><td colspan="8" style="padding:14px;color:var(--muted);font-size:12.4px">' +
      'Showing the first 400 of ' + list.length + ' — they are all still covered by the ' +
      'tick box at the top of this column.</td></tr>');
  }

  paintBulk();
  $('#kLive').textContent = PROGS.filter(p => p.active).length;
  $('#kHidden').textContent = PROGS.filter(p => !p.active).length;
  $('#kFree').textContent = PROGS.filter(p => p.active && p.totalInr === 0).length;
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
      field('Total tuition, ₹', 'fFee', v.totalInr || 0, 'type="number" min="0" step="1000"',
        'Whole course, in rupees. <b>0 means no tuition</b> — that is load-bearing on the site.') +
      select('Budget band', 'fBand', v.band, BANDS,
        'Leave it on the first option and it is worked out from the fee.') +
      field('Course page', 'fUrl', v.url, 'placeholder="https://…"',
        'Must start with http. Students click through to it.') +
    '</div>' +
    '<h3 style="font-size:14px;margin:6px 0 10px">Application deadlines</h3>' +
    '<div id="intakes">' + ins.map((i, n) =>
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:10px">' +
      select('Intake ' + (n + 1), 'fSeason' + n, i.season,
        [['winter', 'Winter'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['spring', 'Spring']]) +
      field('Closes', 'fDeadline' + n, i.deadline, 'type="date"') + '</div>').join('') +
    '</div>' +
    '<label style="display:flex;gap:9px;align-items:center;font:600 13px/1.4 var(--sans);' +
      'color:var(--navy-800);margin-top:8px">' +
      '<input type="checkbox" id="fActive"' + (v.active === false ? '' : ' checked') + '> ' +
      'Show this on the website</label>' +
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
    featured: $('#fFeatured').checked,
    featureSort: Number($('#fFeatureSort').value || 0),
    totalInr: Number($('#fFee').value || 0),
    url: $('#fUrl').value.trim(),
    active: $('#fActive').checked,
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
  $('#bulkCount').textContent = n + (n === 1 ? ' selected' : ' selected');
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
    PICKED.clear();
    await reload();
    const bits = [];
    if (r.deleted) bits.push(r.deleted + ' removed');
    if (r.hidden) bits.push(r.hidden + ' taken off the site');
    if (r.shown) bits.push(r.shown + ' put back on the site');
    if (r.missing) bits.push(r.missing + ' already gone');
    toast(bits.join(', ') || 'Nothing to do.');
    if (action === 'delete' && r.keptNames && r.keptNames.length) {
      alert('Kept, because a student has these shortlisted or has applied — they were taken '
        + 'off the site instead:\n\n' + r.keptNames.join('\n'));
    }
  } catch (err) { toast(err.message); }
}

async function reload() {
  const r = await api('GET', '/api/staff/catalogue');
  PROGS = r.programmes;
  DESTS = r.countries;
  LOG = r.audit;
  paintDests(); paintProgs(); paintLog();
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

document.addEventListener('change', e => {
  const box = e.target.closest('[data-pick]');
  if (box) {
    box.checked ? PICKED.add(box.dataset.pick) : PICKED.delete(box.dataset.pick);
    const row = box.closest('tr');
    if (row) row.style.background = box.checked ? '#f4f7fb' : '';
    paintBulk();
    return;
  }
  if (e.target.id === 'selAll') {
    SHOWN.forEach(id => e.target.checked ? PICKED.add(id) : PICKED.delete(id));
    paintProgs();
  }
});

document.addEventListener('click', async e => {
  if (e.target.closest('#bulkClear')) { PICKED.clear(); paintProgs(); return; }
  if (e.target.closest('#bulkHide')) return bulkDo('hide');
  if (e.target.closest('#bulkShow')) return bulkDo('show');
  if (e.target.closest('#bulkDelete')) return bulkDo('delete');

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

['q', 'fc', 'fs'].forEach(id => {
  $('#' + id).addEventListener('input', paintProgs);
  $('#' + id).addEventListener('change', paintProgs);
});
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
