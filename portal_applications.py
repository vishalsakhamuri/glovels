"""Applications — one tracker per shortlisted university."""

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

    <div class="out tiles" style="--tiles:4;margin:0 0 20px">
      <div><b id="kTotal">0</b><span>Applications</span></div>
      <div><b id="kSent">0</b><span>Submitted</span></div>
      <div><b id="kDec">0</b><span>Decisions in</span></div>
      <div><b id="kOffer">0</b><span>Offers</span></div>
    </div>

    <div class="warnbox" style="background:#eaf1fd;border:1px solid #c2d6f5;color:var(--blue-deep);
      border-radius:12px;padding:13px 15px;font-size:12.8px;line-height:1.55;display:flex;gap:9px;
      margin-bottom:22px">
      <svg class="ico" aria-hidden="true"><use href="#i-info"/></svg><span>Admission is the
      university's decision. What Glovels guarantees is that your file is the strongest it can be
      and that none of it is left unchased — every application here is followed up until a decision
      is on record.</span>
    </div>

    <div id="appList"></div>
"""

SCRIPT = r"""
/* The five stages an application actually passes through. Kept as data so the
   tracker, the counters and the "what happens next" line cannot disagree. */
const STAGES = [
  {k:'docs',   n:'Documents collected', d:'Everything the university asks for, verified and in order.'},
  {k:'draft',  n:'Application drafted', d:'Forms filled, SOP and LORs attached, checked line by line.'},
  {k:'sent',   n:'Submitted',           d:'Filed with the university, reference number on record.'},
  {k:'review', n:'Under review',        d:'With the admissions committee. We follow up on a schedule.'},
  {k:'decided',n:'Decision',            d:'Offer, rejection or a request for more information.'}
];



/* One tracker per shortlisted programme. The shortlist and the stage of each
   application both live on the server, so this screen agrees with the dashboard
   and survives a different browser. */
DB.short = DB.short || [];
DB.apps = DB.apps || {};
const ids = () => DB.short;

function stateOf(id) {
  if (!DB.apps[id]) DB.apps[id] = {stage: 0, outcome: ''};
  return DB.apps[id];
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
const nextDeadline = upcoming;
function daysLeft(p) {
  const d = nextDeadline(p);
  if (!d) return null;
  return Math.round((d - new Date()) / 86400000);
}

function block(id) {
  const p = byId[id];
  if (!p) return '';
  const s = stateOf(id);
  const dl = nextDeadline(p);
  const left = daysLeft(p);
  const flag = (COUNTRIES[p.country] || {}).flag || '';
  const cname = (COUNTRIES[p.country] || {}).name || p.country;
  const done = s.stage >= STAGES.length - 1 && s.outcome;

  return '<div class="p-card" style="margin-bottom:16px" data-app="' + id + '">' +
    '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px">' +
      '<span style="font-size:22px">' + flag + '</span>' +
      '<div style="flex:1;min-width:200px">' +
        '<h3 style="margin:0 0 3px;font-size:15.5px">' + esc(p.program) + '</h3>' +
        '<div style="font-size:12.8px;color:var(--navy-700)">' + esc(p.university) + '</div>' +
        '<div style="font-size:11.8px;color:var(--muted);margin-top:2px">' + esc(cname) +
          ' · ' + (p.isPublic ? 'Public' : 'Private') + '</div>' +
      '</div>' +
      (done
        ? '<span class="badge ' + (s.outcome === 'offer' ? 'badge-start' : 'badge-value') + '">' +
          (s.outcome === 'offer' ? 'Offer received' : 'Not offered') + '</span>'
        : dl ? '<span class="badge ' + (left != null && left < 30 ? 'badge-best' : 'badge-value') + '">' +
          (left != null && left < 0 ? 'Deadline passed'
            : left + ' days to ' + dl.toLocaleDateString('en-GB', {day:'numeric', month:'short'})) +
          '</span>' : '') +
    '</div>' +

    '<ul class="track" style="margin-bottom:16px">' + STAGES.map((st, i) => {
      const cls = (i < s.stage || (done && i === s.stage)) ? 'done'
                : i === s.stage ? 'now' : '';
      return '<li class="' + cls + '"><span class="dot">' + (i < s.stage ? ico('check') : '') +
        '</span><span><b>' + esc(st.n) + '</b>' + esc(st.d) + '</span></li>';
    }).join('') + '</ul>' +

    /* THIS TRACKER IS THE OFFICE'S RECORD, NOT THE STUDENT'S.
     *
     * "The student can mark Documents Collected as Done, whereas the
     * counsellor is the one who verifies and marks it as done."
     *
     * Every stage on this list is something GLOVELS does — collect the
     * documents and check them, draft the application, file it, follow it up,
     * record what came back. A student pressing "done" on any of them was
     * writing the office's record of the office's own work: their dashboard,
     * their counsellor's list and the office's counters all moved, and nobody
     * had collected anything.
     *
     * So the buttons are gone and the line under the tracker says who moves it
     * and how to ask. Nothing is taken away from the student that was theirs:
     * they can still see exactly where the application has got to, which is
     * what this screen is for. */
    '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:center">' +
      '<span style="font:400 12.4px/1.55 var(--sans);color:var(--muted)">' +
        (done ? 'This one is finished.'
              : 'Your counsellor moves this on as each step is done.') +
      '</span>' +
      '<a class="btn btn-ghost btn-sm" href="messages.html" style="margin-left:auto">' +
        ico('chat') + ' Ask about this</a>' +
    '</div></div>';
}

function paint() {
  const list = ids();
  $('#appList').innerHTML = list.map(block).join('') ||
    '<div class="sl-empty"><b>No applications yet</b><p>Add universities to your shortlist and ' +
    'each one gets its own tracker here.</p>' +
    '<a class="btn btn-primary" href="universities.html">Go to My Universities</a></div>';
  const st = list.map(stateOf);
  $('#kTotal').textContent = list.length;
  $('#kSent').textContent  = st.filter(s => s.stage >= 2).length;
  $('#kDec').textContent   = st.filter(s => s.outcome).length;
  $('#kOffer').textContent = st.filter(s => s.outcome === 'offer').length;
  save();
}

/* The advance, outcome and undo handlers that used to be here are gone with
   the buttons above. The server refuses a student moving their own application
   forward as well, because a button being absent from a page is not the same
   as an endpoint being closed. */

paint();
"""
