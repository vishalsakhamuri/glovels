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
          <div class="field"><label>Entry requirement</label><select id="fReach">
            <option value="mine">Ones I qualify for</option>
            <option value="all">Show every programme</option></select></div>
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
/*
 * The CGPA a programme actually asks for — its own if it states one, otherwise
 * the destination's rule for that kind of university.
 *
 * This is the same formula the public finder uses, deliberately copied rather
 * than approximated. A student who was shown a university on glovels.com and
 * then cannot find it after signing in has been told two different things by
 * the same company, and the one they believe is the one that cost them money.
 */
function barOf(p) {
  if (p.minCgpa != null && p.minCgpa !== '') return Number(p.minCgpa);
  const c = COUNTRIES[p.country] || {};
  const own = p.isPublic ? c.minCgpaPublic : c.minCgpaPrivate;
  if (own != null) return Number(own);
  const back = p.isPublic ? CGPA_RULE.full : CGPA_RULE.partial;
  return back == null ? null : Number(back);
}

/* Their own, off the profile they filled in. Blank is not zero — it means
   they have not told us, and a filter that reads it as zero would quietly
   empty this screen for every student who skipped the field. */
function myCgpa() {
  const raw = String(((typeof DB !== 'undefined' && DB.profile) || {}).d_cgpa || '').trim();
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function clears(p) {
  const mine = myCgpa(), bar = barOf(p);
  if (mine == null || bar == null) return true;   // nothing stated, nothing to fail
  return mine >= bar;
}

function flagOf(p) { return (COUNTRIES[p.country] || {}).flag || ''; }
function nameOf(p)  { return (COUNTRIES[p.country] || {}).name || p.country; }

/* How long there is, said in the unit somebody acts on. "15 Jan 2027" is a
   fact; "start now — that is 5 weeks away" is a decision. */
function whenToApply(p) {
  const d = upcoming(p);
  if (!d) return '';
  const days = Math.round((d - new Date()) / 86400000);
  if (days <= 0) return 'The deadline has passed — ask your counsellor about the next intake.';
  /* Applications are not a same-week job: documents have to be attested,
     transcripts requested, and for Germany the APS alone takes 6–8 weeks. */
  if (days <= 21) return 'Start today — the deadline is ' + days + ' day'
    + (days === 1 ? '' : 's') + ' away, which is tight.';
  if (days <= 60) return 'Start this week. ' + days + ' days left, and documents take '
    + 'longer than people expect.';
  if (days <= 150) return 'Begin gathering documents now — ' + Math.round(days / 7)
    + ' weeks to the deadline.';
  return Math.round(days / 30) + ' months to the deadline. Nothing is urgent yet.';
}

function needsBlock(p) {
  const c = COUNTRIES[p.country] || {};
  const docs = (c.documents || []).filter(Boolean);
  const tests = (c.tests || []).filter(Boolean);
  const when = whenToApply(p);
  if (!docs.length && !tests.length && !when) return '';
  const li = (label, list) => !list.length ? ''
    : '<div style="margin-top:8px"><b style="display:block;font:700 10.6px/1 var(--sans);'
      + 'letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:5px">'
      + label + '</b><span style="font-size:12px;line-height:1.6;color:var(--navy-800)">'
      + list.map(esc).join(' · ') + '</span></div>';
  return '<details class="uneeds" style="margin-top:9px">'
    + '<summary style="cursor:pointer;font:700 12px/1.4 var(--sans);color:var(--navy-800)">'
    + 'What it takes to apply</summary>'
    + (when ? '<p style="margin:8px 0 0;font-size:12.2px;line-height:1.55;'
        + 'color:var(--navy-900)"><b>' + esc(when) + '</b></p>' : '')
    + li('Documents', docs)
    + li('Tests', tests)
    + (c.degreeRule ? '<div style="margin-top:8px;font-size:11.8px;line-height:1.6;'
        + 'color:var(--muted)">' + esc(c.degreeRule) + '</div>' : '')
    + (c.extraNote ? '<div style="margin-top:6px;font-size:11.8px;line-height:1.6;'
        + 'color:#8a5a0b">' + esc(c.extraNote) + '</div>' : '')
    + '<p style="margin:9px 0 0;font-size:11.4px;color:var(--muted)">These are the '
    + esc(nameOf(p)) + ' rules, kept up to date by the office. Your counsellor files '
    + 'each of these with you.</p>'
    + '</details>';
}

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
    /* Said on the card, not only in the filter. A student browsing with the
       filter switched off is entitled to know which of these would turn them
       away, and a student who clears it is entitled to see that they do. */
    /* What it actually takes to apply to this one, on the card rather than in
       a counsellor's head. "Each university will give him deadline date etc,
       and when to apply, and what docs are needed to apply."
       The deadline was already here; the other two were not, and they are the
       two that decide whether somebody starts in time. Closed by default —
       twelve cards each shouting a document list is a wall. */
    needsBlock(p) +
    (barOf(p) == null ? '' :
      '<div class="sl-meta" style="color:' + (clears(p) ? 'var(--muted)' : '#b42318') + '">' +
      (clears(p) ? 'Asks for ' + barOf(p) + '+ CGPA'
                 : 'Asks for ' + barOf(p) + '+ CGPA — above yours') + '</div>') +
    '<div class="sl-go" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      (inList === 'matched'
        /* A university the package delivered. It is not "waiting" on anybody —
           it is theirs, and the only thing they might want is a different one.
           "He can check and, in case any changes are required, he can consult
            the counsellor. Counsellor can add or change the universities for
            him." So the card offers the conversation, not a delete: a student
           removing one of the universities they paid for, with nobody told and
           no undo, is not a convenience. */
        ? '<a class="btn btn-ghost btn-sm" href="messages.html?about='
          + encodeURIComponent(p.university || p.program || p.id)
          + '">Ask about this one</a>'
        : inList === 'want'
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
  if (!row) return 'office';
  /* Three owners now, not two. 'matched' is what the machine picked the moment
     an entry package was paid for — not the student's browsing, and not a
     counsellor's judgement either, and saying it is one of those would be a
     small lie on the one screen a student checks. */
  if (row.addedBy === 'student') return 'student';
  if (row.addedBy === 'matched') return 'matched';
  return 'office';
};

function paintMine() {
  const items = shortlist().map(i => byId[i]).filter(Boolean);
  const mine  = items.filter(p => ownerOf(p.id) === 'student');
  const auto  = items.filter(p => ownerOf(p.id) === 'matched');
  const ours  = items.filter(p => ownerOf(p.id) === 'office');
  $('#nMine').textContent = items.length;

  const grid = (list, withApply) =>
    '<div class="sl-grid">' + list.map(p => card(p, withApply)).join('') + '</div>';

  const head = (title, sub) =>
    '<div style="margin:0 0 12px">'
    + '<h3 style="margin:0;font-size:16.5px;color:var(--navy-900)">' + title + '</h3>'
    + '<p style="margin:4px 0 0;font-size:12.6px;color:var(--muted);line-height:1.6">'
    + sub + '</p></div>';

  let html = '';

  /* ------------------------------------------------- what the machine delivered
     First, because it is what an entry package bought and it arrived within
     the minute. A student who paid ₹99 at eleven at night and opens this screen
     should see the thing they paid for at the top, not below two empty boxes. */
  const M = (typeof MATCHED !== 'undefined' && MATCHED) ? MATCHED : null;
  if (auto.length) {
    html += head('Matched to your profile',
      'Picked from what you told us — marks, budget, country and intake. '
      + 'Update your profile and they are picked again.');
    html += grid(auto, 'matched');
    html += '<div style="height:30px"></div>';
  } else if (M && M.owed && M.needsProfile) {
    /* Paid for, and waiting on them. This is the one state where saying
       nothing would look like the money went nowhere. */
    html += '<div class="sl-empty" style="margin-bottom:30px">'
      + '<b>Your ' + M.owed + ' matched universities are waiting on six questions</b>'
      + '<p>Tell us what you are applying for, where, and what you can spend, and '
      + 'they appear here straight away. Nobody has to call you.</p>'
      + '<a class="btn btn-primary" href="profile.html">Answer them now</a></div>';
  } else if (M && M.owed && M.cgpaHeld) {
    /* Paid for, profile complete, and NOTHING the machine can honestly send.
       The matcher used to hand over universities the student would have been
       rejected by, because it read a programme's own CGPA bar and almost no
       programme states one — the rule lives on the destination. Now it reads
       the destination's rule too, and a student below every public bar in the
       catalogue correctly gets none.
       An empty screen after paying would be worse than the old wrong list. */
    html += '<div class="sl-empty" style="margin-bottom:30px">'
      + '<b>We have not put anything here, and it is not an oversight</b>'
      + '<p>' + M.cgpaHeld + ' universit' + (M.cgpaHeld === 1 ? 'y asks' : 'ies ask')
      + ' for a higher CGPA than the one on your profile, so '
      + (M.cgpaHeld === 1 ? 'it is' : 'they are')
      + ' not on your list — an application to '
      + (M.cgpaHeld === 1 ? 'it' : 'them') + ' would be turned down on the first line '
      + 'of the form, and your ' + esc(M.package || 'package') + ' still owes you '
      + M.owed + '. Your counsellor can tell you which take a bridging year, and '
      + 'which countries ask for less.</p>'
      + '<a class="btn btn-primary" href="messages.html">Ask my counsellor</a> '
      + '<a class="btn btn-ghost" href="profile.html">Check my marks</a></div>';
  }

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
let outOfReach = 0;
function filtered() {
  const c = $('#fCountry').value, b = $('#fBand').value, t = $('#fType').value, s = $('#fSort').value;
  const r = ($('#fReach') || {}).value || 'mine';
  let l = POOL.filter(p =>
    (!c || p.country === c) && (!b || p.band === b) &&
    (!t || (t === 'pub' ? p.isPublic : !p.isPublic)));
  /* Counted before it is applied, so the line under the filters can say how
     many were held back rather than leaving the student to wonder why a
     country they know has fifty universities is showing four. Hiding them
     silently is the thing to avoid; hiding them is not. */
  const short = l.filter(p => !clears(p));
  outOfReach = short.length;
  if (r === 'mine') l = l.filter(clears);
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
  const mine = myCgpa();
  $('#cCount').textContent = l.length + ' programme' + (l.length === 1 ? '' : 's') +
    ' match — showing ' + Math.min(shown, l.length) + '.' +
    (mine == null
      ? '  Add your CGPA on My Profile and this list will only show what you can apply to.'
      : ($('#fReach').value === 'mine' && outOfReach
          ? '  ' + outOfReach + ' more ask for a higher CGPA than ' + mine +
            ' — switch to “Show every programme” to see them.'
          : ''));
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
['fCountry','fBand','fType','fReach','fSort'].forEach(id =>
  $('#' + id).addEventListener('change', () => { shown = 12; paintBrowse(); }));
$('#moreBtn').addEventListener('click', () => { shown += 12; paintBrowse(); });

paintMine(); paintBrowse();
"""
