"""Applications — one tracker per shortlisted university."""
from portal_fields import APPS_JS

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

    <!--
      SIX, and they are the six the counsellors asked for by name:
      "application overview: shortlisted, in prep, submitted, waitlist,
      rejections, offers."

      The four that were here answered a different question. "Applications",
      "Submitted", "Decisions in", "Offers" told a student how much had gone
      out and how much had come back, and said nothing at all about the part
      they are actually waiting through — the weeks between being shortlisted
      and being filed, which is most of the elapsed time and all of the
      anxiety. "In prep" is that gap, named.

      And a waitlist and a rejection are now their own numbers rather than
      both hiding inside "Decisions in", which counted them together with
      offers and therefore counted nothing anybody wanted to know.
    -->
    <div class="out tiles" style="--tiles:6;margin:0 0 20px">
      <div><b id="kTotal">0</b><span>Shortlisted</span></div>
      <div><b id="kPrep">0</b><span>In prep</span></div>
      <div><b id="kSent">0</b><span>Submitted</span></div>
      <div><b id="kWait">0</b><span>Waitlisted</span></div>
      <div><b id="kRej">0</b><span>Rejections</span></div>
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

SCRIPT = APPS_JS + r"""



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

/* WHAT IS ACTUALLY HAPPENING ON THIS ONE, in the counsellor's own words.
 *
 * "A status update text box for each application."
 *
 * The tracker above says which of five steps it has reached and the badge says
 * what the university answered. Neither can say "their portal was down on
 * Friday, we filed on Monday, the reference is TUM-4471" — and that sentence
 * is the entire reason a student opens this screen. It went into the chat
 * before, where it scrolled away from the application it was about and had to
 * be found again by a person who did not know what they were looking for.
 *
 * Read-only here. The route that writes it is behind caseworkOnly, and this
 * screen has no box: a student typing into their counsellor's record of the
 * office's own work is the same mistake as the stage buttons that used to be
 * on this card.
 */
function noteBlock(s) {
  const note = String((s && s.note) || '').trim();
  if (!note) return '';
  const when = (s && s.noteAt) ? new Date(s.noteAt) : null;
  return '<div style="background:#f6f8fc;border:1px solid var(--line);border-radius:11px;' +
    'padding:12px 14px;margin-bottom:14px">' +
    '<div style="font:700 11.4px/1 var(--sans);letter-spacing:.05em;text-transform:uppercase;' +
      'color:var(--muted);margin-bottom:6px">Latest from your counsellor' +
      (when && !isNaN(when) ? ' · ' + when.toLocaleDateString('en-GB',
        {day:'numeric', month:'short', year:'numeric'}) : '') + '</div>' +
    '<div style="font:400 13px/1.6 var(--sans);color:var(--navy-800);white-space:pre-wrap">' +
      esc(note) + '</div></div>';
}

/* THE TWO FILES THAT BELONG TO THIS APPLICATION AND TO NOTHING ELSE.
 *
 * "Option to upload the screenshot of the submitted application, and the
 * decision PDF."
 *
 * Not on the Documents screen, which is the fourteen things the STUDENT has to
 * provide and whose counters would have moved for a file they did not send.
 * These are ours: proof we filed, and what came back. The student may open
 * both and may remove neither — the server refuses it as well, because a
 * control being absent from a page is not the same as an endpoint being shut.
 */
function filesBlock(id) {
  const bag = (DB.appFiles || {})[id] || {};
  const rows = [['proof', 'Submission confirmation'], ['decision', 'Decision letter']]
    .map(([k, label]) => {
      const slot = bag[k];
      if (!slot || !(slot.files || []).length) return '';
      return '<div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;' +
        'font-size:12.6px;margin-top:5px">' +
        '<b style="font-weight:600;color:var(--navy-800)">' + label + '</b>' +
        slot.files.map(f => '<a href="/api/documents/file/' + f.id + '" target="_blank" ' +
          'rel="noopener" style="color:var(--blue-deep);text-decoration:underline">' +
          esc(f.file) + '</a>').join('<span style="color:var(--muted)">·</span>') +
        '</div>';
    }).join('');
  if (!rows) return '';
  return '<div style="border-top:1px solid var(--line);padding-top:11px;margin-bottom:14px">' +
    rows + '</div>';
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
        '<div style="font-size:12.8px;color:var(--navy-700)" title="' + esc(uniFull(p))
          + '">' + esc(uniName(p)) + '</div>' +
        '<div style="font-size:11.8px;color:var(--muted);margin-top:2px">' + esc(cname) +
          ' · ' + (p.isPublic ? 'Public' : 'Private') + '</div>' +
      '</div>' +
      /* The university's own answer, in its own words. This read "Offer
         received" for an offer and "Not offered" for everything else, which
         was true while there were only two answers and became false the moment
         there were seven: a student who has ENROLLED was being shown "Not
         offered" on the application they enrolled through. */
      (done
        ? '<span class="badge ' + (outcomeOf(s.outcome).tone === 'ok' ? 'badge-start'
            : outcomeOf(s.outcome).tone === 'bad' ? 'badge-value' : 'badge-value') + '">' +
          esc(outcomeOf(s.outcome).n) + '</span>'
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
    noteBlock(s) +
    filesBlock(id) +

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
    '<a class="btn btn-primary" href="universities.html">Go to My Programs</a></div>';
  const st = list.map(stateOf);
  $('#kTotal').textContent = list.length;
  /* SUBMITTED IS STAGE 2 OR PAST IT — filed, under review, decided. Once a
     thing has been sent it stays sent, so this counts forward rather than
     matching one stage. */
  const sent = s => s.stage >= 2;
  $('#kSent').textContent  = st.filter(sent).length;
  /* IN PREP is the rest: shortlisted, documents being collected, application
     being drafted — everything before it goes out. It is deliberately the
     complement of "submitted" rather than a stage test of its own, so the two
     always add up to the shortlist and a stage added later cannot fall
     through the gap between them. */
  $('#kPrep').textContent  = st.filter(s => !sent(s)).length;
  $('#kWait').textContent  = st.filter(s => s.outcome === 'waitlist').length;
  $('#kRej').textContent   = st.filter(s => s.outcome === 'rejected').length;
  /* An offer ARRIVED — which is also true of one that was taken up and one
     that was not. Counting only the rows still sitting at 'offer' understates
     the year every time somebody records what happened next. */
  $('#kOffer').textContent = st.filter(s => hadOffer(s.outcome)).length;
  save();
}

/* The advance, outcome and undo handlers that used to be here are gone with
   the buttons above. The server refuses a student moving their own application
   forward as well, because a button being absent from a page is not the same
   as an endpoint being closed. */

paint();
"""
