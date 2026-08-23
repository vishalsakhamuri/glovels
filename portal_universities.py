"""My Universities — the shortlist, plus the catalogue it is picked from."""

BODY = """
    <div class="tabs" style="margin-bottom:18px">
      <button class="tab" role="tab" aria-selected="true" data-pane="mine">
        <svg class="ico" aria-hidden="true"><use href="#i-star"/></svg> My shortlist
        <span class="n" id="nMine">0</span></button>
      <button class="tab" role="tab" aria-selected="false" data-pane="browse">
        <svg class="ico" aria-hidden="true"><use href="#i-cap"/></svg> Browse programmes
        <span class="n" id="nAll">0</span></button>
    </div>

    <section class="pane active" id="pane-mine">
      <div id="mineWrap"></div>
    </section>

    <section class="pane" id="pane-browse">
      <div class="p-card" style="margin-bottom:16px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">
          <div class="field"><label>Destination</label><select id="fCountry"></select></div>
          <div class="field"><label>Budget band</label><select id="fBand">
            <option value="">Any budget</option><option value="u10">Under ₹10L</option>
            <option value="u20">Under ₹20L</option><option value="above20">₹20L+</option>
            <option value="elite">Top-ranked</option></select></div>
          <div class="field"><label>University type</label><select id="fType">
            <option value="">Public and private</option><option value="pub">Public only</option>
            <option value="pri">Private only</option></select></div>
          <div class="field"><label>Sort by</label><select id="fSort">
            <option value="fit">Best fit</option><option value="cost">Tuition, low to high</option>
            <option value="dl">Nearest deadline</option>
            <option value="uni">University A–Z</option></select></div>
        </div>
        <p style="margin:12px 0 0;font-size:12.4px;color:var(--muted)" id="cCount"></p>
      </div>
      <div class="sl-grid" id="allGrid"></div>
      <div style="text-align:center;margin-top:18px">
        <button type="button" class="btn btn-ghost" id="moreBtn">Show more programmes</button>
      </div>
    </section>
"""

SCRIPT = r"""
/* The shortlist comes from the server — it is this student's, stored against
   their account, and it is what the dashboard renders too. Adding or removing
   here writes through to the database. */
DB.short = DB.short || [];
const shortlist = () => DB.short;

function money(p) {
  if (p.totalInr === 0) return '₹0 tuition';
  return '≈ ₹' + (p.totalInr / 100000).toFixed(p.totalInr % 100000 ? 1 : 0) + 'L total';
}
/* Intakes repeat every year, and the ones in the catalogue are last cycle's
   dates — so half the shortlist would read "deadline passed" on a page whose
   whole job is to tell a student what to do next. A date in the past is rolled
   forward whole years until it is ahead of today, which is what "the winter
   intake closes 15 July" actually means.
   ⚠️ This is a display convenience, not a data fix. Refresh the intake dates in
   Glovels_Content_Master.xlsx and it becomes a no-op. */
function upcoming(p) {
  const now = new Date();
  const dates = (p.intakes || []).map(i => {
    const d = new Date(i.deadline);
    if (isNaN(d)) return null;
    while (d < now) d.setFullYear(d.getFullYear() + 1);
    return d;
  }).filter(Boolean).sort((a, b) => a - b);
  return dates[0] || null;
}
function nextDeadline(p) {
  const d = upcoming(p);
  return d ? d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}) : '';
}
function flagOf(p) { return (COUNTRIES[p.country] || {}).flag || ''; }
function nameOf(p)  { return (COUNTRIES[p.country] || {}).name || p.country; }

function card(p, inList) {
  return '<article class="sl" data-id="' + p.id + '">' +
    '<span class="sl-flag">' + flagOf(p) + '</span>' +
    '<h3>' + esc(p.program) + '</h3>' +
    '<div class="uni">' + esc(p.university) + '</div>' +
    '<div class="city">' + esc([p.city, nameOf(p)].filter(Boolean).join(' · ')) + '</div>' +
    '<span class="sl-tag">' + ico(p.isPublic ? 'check' : 'star') + ' ' +
      (p.isPublic ? 'Public university' : 'Private university') + '</span>' +
    '<div class="sl-meta"><b>' + money(p) + '</b></div>' +
    (nextDeadline(p) ? '<div class="sl-meta" style="color:var(--muted)">Next deadline: ' +
      nextDeadline(p) + '</div>' : '') +
    (p.fit ? '<div class="sl-chip" style="width:fit-content">Fit score ' + p.fit + '</div>' : '') +
    '<div class="sl-go" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      (inList === 'want'
        /* Already marked, not agreed. Offering "I am interested" again on a
           card that is IN the interested list is the screen asking for
           something it already has. */
        ? '<span style="font:600 12.2px/1.3 var(--sans);color:var(--muted)">'
          + 'Waiting for your counsellor</span>'
        : inList
        /* No Remove. The shortlist is what the package delivered and what the
           counsellor confirms with the student before anything is submitted;
           a button that silently deletes one of the universities they paid
           for, with no undo and nobody told, is not a convenience. Swapping
           one is a conversation, and Messages is one click away. */
        ? '<a class="btn btn-primary btn-sm" href="applications.html">Start application ' + ico('arrow') + '</a>'
        /* Not "Add to shortlist". Pressing it does not put a university on the
           list the office works from — it tells the counsellor you like it,
           and saying otherwise sets up a disappointment. */
        : '<button type="button" class="btn btn-navy btn-sm" data-add="' + p.id + '">I am interested</button>') +
      (p.url ? '<a class="btn btn-ghost btn-sm" href="' + esc(p.url) + '" target="_blank" rel="noopener">Course page</a>' : '') +
    '</div></article>';
}

/**
 * Two lists, because they are two different things.
 *
 * One list conflated what a student liked the look of on a Tuesday evening
 * with what their counsellor agreed with them and is going to apply to. Those
 * do not carry the same weight: the second is what the package delivered, what
 * the applications are filed against, and what any guarantee attaches to.
 * Printing them in one grid meant a student could not tell which universities
 * anybody was actually working on.
 *
 * The counsellor's list is first, because it is the answer to "what is
 * happening with my application". Interest is below it, and is explicitly
 * described as not yet agreed — so nobody reads a browsing session as a plan.
 */
const ownerOf = id => {
  const row = (typeof SHORT_ROWS !== 'undefined' ? SHORT_ROWS : [])
    .find(r => String(r.id) === String(id));
  return row && row.addedBy === 'student' ? 'student' : 'office';
};

function paintMine() {
  const items = shortlist().map(i => byId[i]).filter(Boolean);
  const mine  = items.filter(p => ownerOf(p.id) === 'student');
  const ours  = items.filter(p => ownerOf(p.id) !== 'student');
  $('#nMine').textContent = items.length;

  const grid = (list, withApply) =>
    '<div class="sl-grid">' + list.map(p => card(p, withApply)).join('') + '</div>';

  const head = (title, sub) =>
    '<div style="margin:0 0 12px">'
    + '<h3 style="margin:0;font-size:16.5px;color:var(--navy-900)">' + title + '</h3>'
    + '<p style="margin:4px 0 0;font-size:12.6px;color:var(--muted);line-height:1.6">'
    + sub + '</p></div>';

  let html = '';

  /* ---------------------------------------------- what the office is working on */
  html += head('Your counsellor\u2019s shortlist',
    ours.length
      ? 'Agreed with you, and what your applications are filed against.'
        + (ORDER.publicUnis ? ' Your package covers ' + ORDER.publicUnis + ' universities.' : '')
      : 'Nothing here yet.');
  html += ours.length
    ? grid(ours, true)
    : '<div class="sl-empty"><b>Your counsellor is still building this</b>'
      + '<p>They confirm the list with you before anything is submitted. If you have '
      + 'universities in mind, add them below and they will see them.</p>'
      + '<a class="btn btn-primary" href="messages.html">Message my counsellor</a></div>';

  /* -------------------------------------------------------- what the student likes */
  html += '<div style="margin-top:30px">' + head('Universities you are interested in',
    mine.length
      ? 'Yours, not agreed yet. Your counsellor can see these and will tell you '
        + 'honestly which are realistic for your profile.'
      : 'Nothing here yet.');
  html += mine.length
    ? grid(mine, 'want')
    : '<div class="sl-empty"><b>Nothing marked yet</b>'
      + '<p>Browse the programmes tab and mark the ones you like. Your counsellor sees '
      + 'them and can move any of them onto your real shortlist.</p>'
      + '<button type="button" class="btn btn-ghost" data-goto="browse">Browse programmes</button></div>';
  html += '</div>';

  $('#mineWrap').innerHTML = html;
}

let shown = 12;
function filtered() {
  const c = $('#fCountry').value, b = $('#fBand').value, t = $('#fType').value, s = $('#fSort').value;
  let l = POOL.filter(p =>
    (!c || p.country === c) && (!b || p.band === b) &&
    (!t || (t === 'pub' ? p.isPublic : !p.isPublic)));
  const dl = p => (upcoming(p) || new Date(8640000000000)).getTime();
  l.sort((x, y) =>
    s === 'cost' ? x.totalInr - y.totalInr :
    s === 'dl'   ? dl(x) - dl(y) :
    s === 'uni'  ? x.university.localeCompare(y.university) :
                   (y.fit || 0) - (x.fit || 0));
  return l;
}
function paintBrowse() {
  const l = filtered();
  const ids = shortlist();
  $('#nAll').textContent = POOL.length;
  $('#cCount').textContent = l.length + ' programme' + (l.length === 1 ? '' : 's') +
    ' match — showing ' + Math.min(shown, l.length) + '.';
  $('#allGrid').innerHTML = l.slice(0, shown).map(p => card(p, ids.includes(p.id))).join('');
  $('#moreBtn').style.display = shown >= l.length ? 'none' : '';
}

/* Country list is built from the catalogue, so a destination can never appear
   in the filter with nothing behind it. */
(function () {
  const seen = [...new Set(POOL.map(p => p.country))].sort((a, b) =>
    (COUNTRIES[a] || {}).name > (COUNTRIES[b] || {}).name ? 1 : -1);
  $('#fCountry').innerHTML = '<option value="">Any destination</option>' + seen.map(c =>
    '<option value="' + c + '">' + ((COUNTRIES[c] || {}).flag || '') + ' ' +
    esc((COUNTRIES[c] || {}).name || c) + '</option>').join('');
})();

document.addEventListener('click', e => {
  const tab = e.target.closest('.tab[data-pane]');
  if (tab) {
    $$('.tab[data-pane]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    $$('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab.dataset.pane));
    return;
  }
  const go = e.target.closest('[data-goto]');
  if (go) { $('.tab[data-pane="' + go.dataset.goto + '"]').click(); return; }
  const add = e.target.closest('[data-add]');
  if (add) {
    const ids = shortlist();
    if (!ids.includes(add.dataset.add)) {
      ids.push(add.dataset.add);
      /* SHORT_ROWS is what ownerOf() reads, and it is the server's answer from
         page load. Without this the new row has no entry, ownerOf falls back to
         'office', and the university a student just marked appears under their
         counsellor's shortlist until they reload. */
      if (typeof SHORT_ROWS !== 'undefined' && Array.isArray(SHORT_ROWS)) {
        SHORT_ROWS.push(Object.assign({}, byId[add.dataset.add], { addedBy: 'student' }));
      }
      save();
    }
    paintMine(); paintBrowse();
    toast(byId[add.dataset.add].university
      + ' \u2014 your counsellor can see you are interested.');
    return;
  }
});
['fCountry','fBand','fType','fSort'].forEach(id =>
  $('#' + id).addEventListener('change', () => { shown = 12; paintBrowse(); }));
$('#moreBtn').addEventListener('click', () => { shown += 12; paintBrowse(); });

paintMine(); paintBrowse();
"""
