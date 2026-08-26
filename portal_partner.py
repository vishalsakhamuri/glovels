"""The B2B partner's workspace: a book of students, and each one opened up.

Vishal, in the order he asked for it:

  *"we need b2b login like we have for student where B2B counsellors can upload
  multiple students profiles and also track their status, shortlist unis and
  visa process etc from that login"*
  *"agency should be able to upload all documents for student and details and
  also visa related for each student and they should be able to see shortlisted
  unis"*
  *"he should be able to add his own login"*
  *"also have dashboard to see the overall status"*
  *"every student can be from different country like someone is going to
  germany and someone is going to uk"*
  *"feel free to make the partner login screen like the best and nice one where
  partner can track each student individually"*

So: a dashboard that answers "how is the whole book doing", a destination strip
because an agency's students are not all going to one place, and a student who
opens into the same four things their own login would have shown — details,
documents, visa, universities.

The field lists and both document checklists come from `portal_fields.py`,
shared with the student's own screens. An agency doing the paperwork is filling
in THE record, not a second one shaped like it, and two hand-maintained copies
of "what a passport is called" is how two screens start disagreeing.
"""

from portal_fields import SECTIONS_JS, DOCS_JS, VISA_JS

BODY = """
    <style>
      /* The shared portal sheet puts a 1180px floor under every table, which
         is right for the Organisation screen's eight columns and wrong here.
         The floor is what these columns actually need. */
      .p-card > .tbl.ptbl{min-width:760px}
      /* The counter row. This rule lives in the Organisation screen's own
         style block, so a fourth tile here wrapped onto a second line by
         itself and read as an afterthought. */
      .out.tiles{grid-template-columns:repeat(var(--tiles,4),1fr)}
      @media (max-width:980px){ .out.tiles{grid-template-columns:repeat(2,1fr)} }
      @media (max-width:520px){ .out.tiles{grid-template-columns:1fr} }
      .pcols{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;
        align-items:start}
      @media (max-width:1180px){ .pcols{grid-template-columns:minmax(0,1fr)} }

      /* Where everybody is going. An agency's book is not one country, and a
         screen that totals them into a single number hides the only split that
         changes what happens next. */
      .dests{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}
      .dest{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;
        border-radius:999px;border:1.5px solid var(--line);background:var(--paper);
        font:700 12.4px/1 var(--sans);color:var(--navy-800);cursor:pointer;
        transition:border-color .12s, background .12s}
      .dest:hover{border-color:var(--navy-600)}
      .dest b{font-size:12.4px}
      .dest .n{font:800 11px/1 var(--sans);padding:4px 7px;border-radius:999px;
        background:#eef3fb;color:var(--navy-700)}
      .dest[aria-pressed="true"]{border-color:var(--navy-700);background:var(--navy-900);
        color:#fff}
      .dest[aria-pressed="true"] .n{background:rgba(255,255,255,.18);color:#fff}

      .prow{cursor:pointer}
      .prow:hover{background:var(--cream)}

      /* One student, opened. */
      .pback{display:inline-flex;align-items:center;gap:7px;font:700 12.6px/1 var(--sans);
        color:var(--navy-700);cursor:pointer;background:none;border:0;padding:0;margin:0 0 14px}
      .pback:hover{color:var(--blue-deep)}
      .pback .ico{font-size:15px;transform:rotate(180deg)}
      .ptabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:0 0 18px;
        overflow-x:auto;scrollbar-width:none}
      .ptabs::-webkit-scrollbar{display:none}
      .ptab{appearance:none;border:0;background:none;cursor:pointer;white-space:nowrap;
        font:700 13px/1 var(--sans);color:var(--muted);padding:12px 14px;
        border-bottom:2.5px solid transparent;margin-bottom:-1px}
      .ptab:hover{color:var(--navy-800)}
      .ptab[aria-selected="true"]{color:var(--navy-900);border-bottom-color:var(--navy-700)}
      .ppane{display:none}
      .ppane.on{display:block}

      /* A document slot. Every one says what it BLOCKS, not just what it is —
         an agency looking at a list of nouns chases nothing. */
      .dcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px}
      .dcard{border:1.5px solid var(--line);border-radius:13px;padding:14px 15px;
        background:var(--paper)}
      .dcard.ok{border-color:#bfe0cc;background:#f6fbf8}
      .dcard.wait{border-color:#e6d5a8;background:#fdfaf2}
      .dcard.need{border-color:#e0b4ae;background:#fdf7f6}
      .dcard b{display:block;font:700 13.2px/1.35 var(--sans);color:var(--navy-900)}
      .dcard .blocks{display:block;margin-top:4px;font-size:11.6px;line-height:1.5;
        color:var(--muted)}
      .dcard .foot{display:flex;align-items:center;gap:8px;margin-top:11px;flex-wrap:wrap}
      .dcard input[type=file]{display:none}
      .dlab{display:inline-flex;align-items:center;gap:6px;cursor:pointer;
        font:700 12px/1 var(--sans);padding:8px 12px;border-radius:9px;
        border:1.5px solid #d3d9e2;background:var(--paper);color:var(--navy-800)}
      .dlab:hover{border-color:var(--navy-600)}

      .pfields{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
      @media (max-width:760px){ .pfields{grid-template-columns:1fr} }
      .pgrp{margin:0 0 22px}
      .pgrp > h3{font:700 14px/1 var(--sans);color:var(--navy-900);margin:0 0 12px;
        display:flex;align-items:center;gap:8px}
    </style>

    <!-- ------------------------------------------------------- the book -->
    <div id="listView">
      <div class="out tiles" style="--tiles:4;margin:0 0 18px">
        <div><b id="kStudents">—</b><span>Students you sent</span></div>
        <div><b id="kAssigned">—</b><span>With a counsellor</span></div>
        <div><b id="kShort">—</b><span>Shortlisted</span></div>
        <div><b id="kDocs">—</b><span>Documents waiting on us</span></div>
      </div>

      <div class="dests" id="dests"></div>

      <div class="pcols">
        <div class="p-sec" style="min-width:0">
          <div class="p-sec-head"><h2>Your students</h2>
            <input id="findStu" placeholder="Name, email or university"
              style="margin-left:auto;padding:8px 11px;font:400 12.8px/1.4 var(--sans);
              border:1.5px solid #d8dde4;border-radius:9px;min-width:230px"></div>
          <div class="p-card" style="padding:0;overflow-x:auto">
            <table class="tbl ptbl" style="margin:0">
              <thead><tr><th>Student</th><th>Going to</th><th>Shortlist</th>
                <th>Documents</th><th>Where it is</th></tr></thead>
              <tbody id="stuRows"></tbody>
            </table>
            <div id="stuPager"></div>
          </div>
          <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
            Press a row to open a student — their details, their documents, their visa file
            and the universities we have agreed. A student is handed to a Glovels counsellor
            by our office, not from here; until that happens the row says
            <b>waiting for us</b>, and that is on us, not on you.
          </p>
        </div>

        <div style="display:grid;gap:16px;min-width:0">
          <div class="p-sec" style="margin:0">
            <div class="p-sec-head"><h2 style="font-size:16px">Add students</h2></div>
            <div class="p-card">
              <p style="margin:0 0 12px;font-size:12.6px;color:var(--muted);line-height:1.6">
                One at a time, or paste a whole sheet. Name and email are the only
                two we cannot do without.</p>
              <div class="field" style="margin-bottom:10px">
                <label for="aName">Name</label>
                <input id="aName" placeholder="Priya Sharma" style="cursor:text"></div>
              <div class="field" style="margin-bottom:10px">
                <label for="aEmail">Email</label>
                <input id="aEmail" type="email" placeholder="priya@example.com"
                  style="cursor:text"></div>
              <div class="field" style="margin-bottom:10px">
                <label for="aPhone">Mobile</label>
                <input id="aPhone" placeholder="9876543210" style="cursor:text"></div>
              <div class="field" style="margin-bottom:10px">
                <label for="aCountry">Where they want to go</label>
                <select id="aCountry">
                  <option value="">Not decided yet</option>
                  <option>Germany</option><option>Canada</option>
                  <option>United Kingdom</option><option>Ireland</option>
                  <option>Poland</option><option>Spain</option><option>Italy</option>
                </select></div>
              <div class="field" style="margin-bottom:12px">
                <label for="aLevel">Level</label>
                <select id="aLevel">
                  <option value="">Not decided yet</option>
                  <option>Master's</option><option>Bachelor's</option><option>MBA</option>
                  <option>Foundation / Pathway</option><option>PhD</option>
                  <option>Diploma / PG Diploma</option>
                </select></div>
              <button type="button" class="btn btn-primary" id="addOne"
                style="width:100%">Add this student</button>

              <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
                <b style="display:block;font:700 12.4px/1 var(--sans);margin-bottom:7px">
                  Or paste a sheet</b>
                <p style="margin:0 0 8px;font-size:11.8px;color:var(--muted);line-height:1.6">
                  Copy the rows out of Excel and paste them here. One student a line:
                  <b>name, email, mobile, country, level</b>. Up to 200 at a time.</p>
                <textarea id="bulk" rows="5" placeholder="Priya Sharma, priya@example.com, 9876543210, Germany, Master's
Rahul Verma, rahul@example.com, 9876543211, United Kingdom, Master's"
                  style="width:100%;padding:10px 11px;font:400 12.4px/1.5 var(--mono,monospace);
                  border:1.5px solid #d8dde4;border-radius:10px;resize:vertical"></textarea>
                <button type="button" class="btn btn-ghost" id="addMany"
                  style="width:100%;margin-top:9px">Add them all</button>
              </div>
              <div id="addOut" style="margin-top:12px"></div>
            </div>
          </div>

          <div class="p-sec" style="margin:0" id="teamSec" hidden>
            <div class="p-sec-head"><h2 style="font-size:16px">Your team</h2></div>
            <div class="p-card">
              <p style="margin:0 0 11px;font-size:12.4px;color:var(--muted);line-height:1.6">
                Colleagues sign in with their own email and see the same students.</p>
              <ul class="doclist" id="teamList" style="margin:0 0 12px"></ul>
              <div class="field" style="margin-bottom:9px">
                <label for="tName">Their name</label>
                <input id="tName" placeholder="Anita Rao" style="cursor:text"></div>
              <div class="field" style="margin-bottom:10px">
                <label for="tEmail">Their email</label>
                <input id="tEmail" type="email" placeholder="anita@youragency.com"
                  style="cursor:text"></div>
              <button type="button" class="btn btn-ghost" id="addMate"
                style="width:100%">Add a colleague</button>
              <div id="teamOut" style="margin-top:11px"></div>
            </div>
          </div>

          <div class="p-sec" style="margin:0" id="logoSec">
            <div class="p-sec-head"><h2 style="font-size:16px">Your logo</h2></div>
            <div class="p-card">
              <p style="margin:0 0 11px;font-size:12.4px;color:var(--muted);line-height:1.6">
                Shown at the top of this screen, in place of ours. PNG or JPG,
                300KB or under.</p>
              <div id="logoNow" style="margin-bottom:11px"></div>
              <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp"
                style="font:400 12.4px/1.4 var(--sans);width:100%">
              <button type="button" class="btn btn-ghost btn-sm" id="logoClear"
                style="margin-top:9px">Remove it</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- --------------------------------------------------- one student -->
    <div id="oneView" hidden>
      <button type="button" class="pback" id="backToList">
        <svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg> All your students</button>
      <div class="p-card" style="margin-bottom:16px" id="oneHead"></div>
      <div class="ptabs" role="tablist" id="oneTabs">
        <button class="ptab" role="tab" data-p="details" aria-selected="true">Details</button>
        <button class="ptab" role="tab" data-p="docs" aria-selected="false">Documents</button>
        <button class="ptab" role="tab" data-p="visa" aria-selected="false">Visa file</button>
        <button class="ptab" role="tab" data-p="unis" aria-selected="false">Universities</button>
      </div>
      <div class="ppane on" id="p-details"></div>
      <div class="ppane" id="p-docs"></div>
      <div class="ppane" id="p-visa"></div>
      <div class="ppane" id="p-unis"></div>
    </div>
"""

SCRIPT = r"""
""" + SECTIONS_JS + r"""
""" + DOCS_JS + r"""
""" + VISA_JS + r"""

/* The five stages an application passes through, in the office's own words.
   The partner reads the same names their student would, so a conversation
   between the two of them is about the same thing. */
const STAGE_NAME = ['Not started', 'Documents collected', 'Application drafted',
  'Submitted', 'Under review', 'Decision'];

let ME = null, STUDENTS = [], filter = '', dest = '', OPEN = null, TAB = 'details';

/* ------------------------------------------------------------- the book */

function stageChip(s) {
  if (!s.counsellor) return '<span class="st wait">waiting for us</span>';
  if (!s.shortlist.length) return '<span class="st wait">shortlist being built</span>';
  if (!s.furthest) return '<span class="st none">shortlist agreed</span>';
  const n = Math.min(s.furthest, 5);
  return '<span class="st ' + (n >= 5 ? 'ok' : 'wait') + '">' + esc(STAGE_NAME[n]) + '</span>';
}

const destOf = s => s.destination || '';

function row(s) {
  const unis = s.shortlist.length
    ? s.shortlist.slice(0, 2).map(u =>
        '<span class="sl-chip">' + esc(u.university) + '</span>').join(' ')
      + (s.shortlist.length > 2
          ? '<span style="display:block;margin-top:4px;font-size:11.4px;color:var(--muted)">and '
            + (s.shortlist.length - 2) + ' more</span>'
          : '')
    : '<span style="color:var(--muted);font-size:12.4px">—</span>';

  return '<tr class="prow" data-open="' + s.id + '">'
    + '<td><b>' + esc(s.name) + '</b>'
      + '<span style="display:block;font-size:11.6px;color:var(--muted)">'
      + esc(s.email) + (s.phone ? ' · ' + esc(s.phone) : '') + '</span></td>'
    + '<td style="font-size:12.4px">'
      + (destOf(s) ? '<b>' + esc(destOf(s)) + '</b>'
          : '<span style="color:var(--muted)">not decided</span>')
      + (s.level ? '<span style="display:block;font-size:11.4px;color:var(--muted)">'
          + esc([s.level, s.field].filter(Boolean).join(' · ')) + '</span>' : '') + '</td>'
    + '<td style="max-width:240px">' + unis + '</td>'
    + '<td style="font-size:12.4px;white-space:nowrap">'
      + s.docsVerified + '/' + s.docsTotal
      + (s.docsWaiting ? ' <span class="st wait" style="margin-left:4px">'
          + s.docsWaiting + ' waiting</span>' : '') + '</td>'
    + '<td>' + stageChip(s)
      + (s.counsellor
          ? '<span style="display:block;margin-top:4px;font-size:11.4px;color:var(--muted)">'
            + 'with ' + esc(s.counsellor) + '</span>' : '') + '</td>'
    + '</tr>';
}

function paintDests() {
  const by = {};
  STUDENTS.forEach(s => {
    const d = destOf(s) || 'Not decided';
    by[d] = (by[d] || 0) + 1;
  });
  const names = Object.keys(by).sort((a, b) => by[b] - by[a] || a.localeCompare(b));
  const box = $('#dests');
  /* One country is not a split. The strip only earns its space when the book
     actually goes to more than one place. */
  box.hidden = names.length < 2;
  if (box.hidden) { dest = ''; return; }
  box.innerHTML =
    '<button type="button" class="dest" data-dest="" aria-pressed="' + (!dest) + '">'
    + '<b>Everyone</b><span class="n">' + STUDENTS.length + '</span></button>'
    + names.map(d =>
      '<button type="button" class="dest" data-dest="' + esc(d) + '" aria-pressed="'
      + (dest === d) + '"><b>' + esc(d) + '</b><span class="n">' + by[d] + '</span></button>'
    ).join('');
}

function paint() {
  const q = filter.trim().toLowerCase();
  const list = STUDENTS.filter(s => {
    if (dest && (destOf(s) || 'Not decided') !== dest) return false;
    if (!q) return true;
    return (s.name + ' ' + s.email + ' ' + s.shortlist.map(u => u.university).join(' '))
      .toLowerCase().includes(q);
  });

  $('#kStudents').textContent = STUDENTS.length;
  $('#kAssigned').textContent = STUDENTS.filter(s => s.counsellor).length;
  $('#kShort').textContent = STUDENTS.filter(s => s.shortlist.length).length;
  $('#kDocs').textContent = STUDENTS.reduce((n, s) => n + (s.docsWaiting || 0), 0);

  paintDests();
  $('#stuPager').innerHTML = pagerHtml('pstu', list.length, 'students', paint);
  $('#stuRows').innerHTML = paged('pstu', list).map(row).join('')
    || '<tr><td colspan="5" style="padding:22px;color:var(--muted)">'
       + (STUDENTS.length ? 'Nothing matches that.'
          : 'No students yet. Add one on the right, or paste a sheet.')
       + '</td></tr>';
}

/* --------------------------------------------------------- one student */

function head(s) {
  const bits = [s.level, s.field].filter(Boolean).join(' · ');
  return '<div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">'
    + '<div style="flex:1;min-width:220px"><h2 style="margin:0;font-size:21px">'
      + esc(s.name) + '</h2>'
    + '<p style="margin:5px 0 0;font-size:12.8px;color:var(--muted)">'
      + esc(s.email) + (s.phone ? ' · ' + esc(s.phone) : '') + '</p></div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
    + (destOf(s) ? '<span class="route">' + esc(destOf(s)) + '</span>' : '')
    + (bits ? '<span class="sl-chip">' + esc(bits) + '</span>' : '')
    + stageChip(s)
    + '</div></div>'
    + (s.counsellor
        ? '<p style="margin:12px 0 0;font-size:12.4px;color:var(--muted)">Your Glovels '
          + 'counsellor on this file is <b>' + esc(s.counsellor) + '</b>.</p>'
        : '<p style="margin:12px 0 0;font-size:12.4px;color:#8a6d1f">Our office has not '
          + 'handed this one to a counsellor yet. Nothing for you to do — it is on us.</p>');
}

/* The student's own record, rendered from the same field list their own screen
   uses. An agency doing the paperwork is filling in THE record: the counsellor
   reads it, the matcher reads it, and the alerts that chase a missing passport
   read it. */
function detailsPane(s) {
  const p = s.profile || {};
  const field = f => {
    const v = p[f.k] == null ? '' : String(p[f.k]);
    const id = 'f_' + f.k;
    let input;
    if (f.t === 'select') {
      input = '<select id="' + id + '" data-f="' + f.k + '">'
        + (f.o || []).map(o => '<option' + (o === v ? ' selected' : '') + '>'
            + esc(o) + '</option>').join('') + '</select>';
    } else if (f.t === 'textarea') {
      input = '<textarea id="' + id + '" data-f="' + f.k + '" rows="3" placeholder="'
        + esc(f.ph || '') + '" style="width:100%;padding:10px 11px;'
        + 'font:400 13px/1.5 var(--sans);border:1.5px solid #d8dde4;border-radius:10px;'
        + 'resize:vertical">' + esc(v) + '</textarea>';
    } else {
      input = '<input id="' + id + '" data-f="' + f.k + '" type="' + (f.t || 'text')
        + '" value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '" style="cursor:text">';
    }
    return '<div class="field" style="margin-bottom:13px"><label for="' + id + '">'
      + esc(f.l) + '</label>' + input
      + (f.help ? '<span style="display:block;margin-top:5px;font-size:11.4px;'
          + 'color:var(--muted);line-height:1.5">' + esc(f.help) + '</span>' : '')
      + '</div>';
  };

  return SECTIONS.map(sec =>
    '<div class="p-card pgrp"><h3>' + ico(sec.icon.replace(/^i-/, '')) + esc(sec.name) + '</h3>'
    + '<div class="pfields">' + sec.fields.map(field).join('') + '</div></div>').join('')
    + '<div style="display:flex;gap:10px;align-items:center;margin-top:4px">'
    + '<button type="button" class="btn btn-primary" id="saveProfile">Save these details</button>'
    + '<span id="profSaid" style="font:600 12.4px/1.4 var(--sans);color:var(--muted)"></span>'
    + '</div>';
}

const DOC_STATE = { ok: 'Verified by Glovels', wait: 'With Glovels to check', none: 'Not uploaded' };

function docCards(s, list, note) {
  const have = s.docs || {};
  return '<p style="margin:0 0 15px;font-size:12.8px;color:var(--muted);line-height:1.65">'
    + note + '</p>'
    + '<div class="dcards">' + list.map(d => {
      const got = have[d.id];
      const state = got ? got.status : 'none';
      const cls = state === 'ok' ? 'ok' : state === 'wait' ? 'wait' : (d.need ? 'need' : '');
      return '<div class="dcard ' + cls + '">'
        + '<b>' + esc(d.name) + (d.need ? '' : ' <span style="font-weight:600;'
            + 'color:var(--muted);font-size:11.4px">optional</span>') + '</b>'
        + '<span class="blocks">' + esc(d.blocks) + '</span>'
        + '<div class="foot">'
        + '<span class="st ' + (state === 'ok' ? 'ok' : state === 'wait' ? 'wait' : 'none')
          + '">' + DOC_STATE[state] + '</span>'
        + (got ? '<a class="btn btn-ghost btn-sm" href="/api/partner/student/' + s.id
            + '/document/' + encodeURIComponent(d.id) + '/file">Download</a>' : '')
        + '<label class="dlab">' + ico('plus')
          + (got ? 'Replace' : 'Upload')
          + '<input type="file" data-up="' + esc(d.id) + '"></label>'
        + '</div>'
        + (got ? '<span style="display:block;margin-top:8px;font-size:11.4px;'
            + 'color:var(--muted)">' + esc(got.file) + '</span>' : '')
        + '</div>';
    }).join('') + '</div>';
}

function unisPane(s) {
  if (!s.shortlist.length) {
    return '<div class="sl-empty" style="margin:0"><b>No universities yet</b>'
      + '<p>' + (s.counsellor
          ? 'Your Glovels counsellor is building this shortlist. It appears here the '
            + 'moment it is agreed, and you can share it with the student.'
          : 'This one is waiting for a Glovels counsellor. The shortlist comes after that.')
      + '</p></div>';
  }
  return '<div class="p-card" style="padding:0;overflow-x:auto"><table class="tbl" '
    + 'style="margin:0;min-width:640px"><thead><tr><th>University</th><th>Programme</th>'
    + '<th>Where</th><th>Application</th></tr></thead><tbody>'
    + s.shortlist.map(u =>
      '<tr><td><b>' + esc(u.university) + '</b>'
      + (u.isPublic ? ' <span class="st ok" style="margin-left:5px">public</span>' : '')
      + '</td>'
      + '<td style="font-size:12.6px">' + esc(u.program || '—') + '</td>'
      + '<td style="font-size:12.6px">' + esc(u.country || '') + '</td>'
      + '<td>' + (u.stage
          ? '<span class="st ' + (u.stage >= 5 ? 'ok' : 'wait') + '">'
            + esc(STAGE_NAME[Math.min(u.stage, 5)]) + '</span>'
          : '<span class="st none">not started</span>')
        + (u.outcome === 'offer' ? ' <span class="st ok">offer</span>' : '')
        + '</td></tr>').join('')
    + '</tbody></table></div>'
    + '<p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">'
    + 'Agreed with your Glovels counsellor. Adding or removing a university is done by '
    + 'them — ask, and it changes here.</p>';
}

function paintOne() {
  const s = OPEN;
  if (!s) return;
  $('#oneHead').innerHTML = head(s);
  $$('.ptab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.p === TAB)));
  $$('.ppane').forEach(p => p.classList.toggle('on', p.id === 'p-' + TAB));

  $('#p-details').innerHTML = detailsPane(s);
  $('#p-docs').innerHTML = docCards(s, DOCS,
    'Everything a university asks for. Upload what you have — Glovels checks each one and '
    + 'marks it verified, and the student never has to send it twice.');
  $('#p-visa').innerHTML = docCards(s, VISA_DOCS,
    'The visa file. These come after an offer, and the order matters: nothing else moves '
    + 'until the offer letter and the proof of funds are in.');
  $('#p-unis').innerHTML = unisPane(s);
}

async function openStudent(id) {
  try {
    OPEN = await api('GET', '/api/partner/student/' + id);
  } catch (e) { return toast(e.message); }
  TAB = 'details';
  $('#listView').hidden = true;
  $('#oneView').hidden = false;
  /* The heading follows you in. A page still titled "Your students" while one
     student's passport number is on screen is a page you can lose your place
     in with two tabs open. */
  setTitle(OPEN.name, 'Their details, documents, visa file and universities.');
  paintOne();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeStudent() {
  OPEN = null;
  $('#oneView').hidden = true;
  $('#listView').hidden = false;
  setTitle('Your students', 'Everyone you have sent us, and where each one has got to.');
}

function setTitle(h, sub) {
  const h1 = document.querySelector('.p-top h1');
  const p = document.querySelector('.p-top p');
  const crumb = $('#crumb');
  if (h1) h1.textContent = h;
  if (p) p.textContent = sub;
  if (crumb) crumb.textContent = h;
  document.title = h + ' | Glovels';
}

async function refreshList() {
  STUDENTS = (await api('GET', '/api/partner/students')).students;
  paint();
}

/* ------------------------------------------------------------- adding */

function said(html) { $('#addOut').innerHTML = html; }

function report(r) {
  let html = '';
  if (r.added.length) {
    html += '<div class="warnbox" style="border-color:#bfe0cc;background:#eef8f2;color:#14603a">'
      + '<b>' + r.added.length + ' added.</b> Our office will assign each one to a '
      + 'counsellor.</div>';
  }
  if (r.rejected.length) {
    html += '<div class="warnbox" style="margin-top:9px;border-color:#c0392b;'
      + 'background:#fdf3f2;color:#7a2118"><b>' + r.rejected.length + ' not added.</b>'
      + '<ul style="margin:7px 0 0;padding-left:17px;line-height:1.65">'
      + r.rejected.map(x => '<li>' + esc(x.at)
          + (x.who ? ' — ' + esc(x.who) : '') + ': ' + esc(x.why) + '</li>').join('')
      + '</ul></div>';
  }
  said(html);
}

async function addStudents(list, btn) {
  const was = btn.textContent;
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    const r = await api('POST', '/api/partner/students', { students: list });
    report(r);
    if (r.added.length) await refreshList();
  } catch (e) {
    said('<div class="warnbox" style="border-color:#c0392b;background:#fdf3f2;'
      + 'color:#7a2118">' + esc(e.message) + '</div>');
  }
  btn.disabled = false; btn.textContent = was;
}

/* Commas or tabs — Excel gives tabs, a person typing gives commas, and
   refusing one because of the other is how somebody gives up and emails the
   file instead. */
function parseSheet(text) {
  return String(text || '').split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !/^name\s*[,\t]/i.test(l))
    .map(l => {
      const c = l.split(/\t|,/).map(x => x.trim());
      return { name: c[0], email: c[1], phone: c[2], destination: c[3], level: c[4] };
    });
}

/* ---------------------------------------------------------------- team */

async function loadTeam() {
  let r;
  try { r = await api('GET', '/api/partner/team'); } catch (e) { return; }
  $('#teamSec').hidden = !r.isOwner;
  $('#teamList').innerHTML = r.team.map(t =>
    '<li>' + ico('user') + '<span style="flex:1"><b>' + esc(t.name) + '</b>'
    + (t.owner ? ' <span class="st none">owner</span>' : '')
    + (t.me ? ' <span class="st ok">you</span>' : '')
    + '<br><span style="font-size:11.6px;color:var(--muted)">' + esc(t.email)
    + '</span></span>'
    + (t.owner ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-drop="'
        + t.id + '" style="color:#b03a2e">Remove</button>')
    + '</li>').join('');
}

/* ---------------------------------------------------------------- logo */

function showLogo(url) {
  const img = $('#ownLogo');
  const box = $('#logoNow');
  const mark = document.querySelector('.p-logo .logo-img');
  if (url) {
    img.src = url; img.hidden = false;
    img.style.cssText = 'max-width:132px;max-height:52px;display:block';
    if (mark) mark.style.display = 'none';
    if (box) box.innerHTML = '<img src="' + esc(url) + '" alt="Your logo" '
      + 'style="max-width:160px;max-height:60px;border-radius:8px;background:#fff;padding:6px">';
  } else {
    img.hidden = true; img.removeAttribute('src');
    if (mark) mark.style.display = '';
    if (box) box.innerHTML = '<span style="font-size:12.4px;color:var(--muted)">None yet.</span>';
  }
}

async function saveLogo(url) {
  try {
    await api('PUT', '/api/partner/logo', { logo: url });
    showLogo(url);
    toast(url ? 'Logo saved.' : 'Logo removed.');
  } catch (e) { toast(e.message); }
}

/* ------------------------------------------------------------------ boot */
/*
 * Its own boot, not staffBoot. A partner is not staff: /api/staff/me refuses
 * them, and a screen that opens by being refused reads as a broken account.
 */
(async function () {
  let me;
  try {
    me = await api('GET', '/api/partner/me');
  } catch (e) {
    if (e.message === 'signed out') return;
    if (e.mustChange) return mustChangeScreen({ role: 'staff' });
    document.querySelector('.p-main').innerHTML =
      '<div class="sl-empty" style="margin-top:40px"><b>This screen is for partner agencies</b>'
      + '<p>' + esc(e.message) + '</p>'
      + '<a class="btn btn-primary" href="dashboard.html">Go to my dashboard</a></div>';
    return;
  }
  ME = me.partner;
  $('#staffName').textContent = ME.agency || ME.name;
  $('#staffRole').textContent = ME.isOwner ? 'Partner agency' : esc(ME.name);
  $('#staffAv').textContent = (ME.agency || ME.name || '?').trim().charAt(0).toUpperCase();
  showLogo(ME.logo || '');
  /* Only the account that owns the agency changes its mark. A colleague
     seeing the control and being refused is worse than not seeing it. */
  $('#logoSec').hidden = !ME.isOwner;

  await refreshList();
  await loadTeam();

  $('#findStu').addEventListener('input', e => {
    filter = e.target.value; PAGE_AT.pstu = 0; paint();
  });

  document.addEventListener('click', async e => {
    const d = e.target.closest('[data-dest]');
    if (d) { dest = d.dataset.dest; PAGE_AT.pstu = 0; return paint(); }

    const open = e.target.closest('[data-open]');
    if (open) return openStudent(Number(open.dataset.open));

    if (e.target.closest('#backToList')) return closeStudent();

    const tab = e.target.closest('.ptab');
    if (tab) { TAB = tab.dataset.p; return paintOne(); }

    if (e.target.closest('#saveProfile')) {
      const btn = e.target.closest('#saveProfile');
      const profile = {};
      $$('#p-details [data-f]').forEach(i => { profile[i.dataset.f] = i.value; });
      btn.disabled = true;
      try {
        await api('PUT', '/api/partner/student/' + OPEN.id + '/profile', { profile });
        $('#profSaid').textContent = 'Saved.';
        /* The row above shows what they are looking at, and it comes out of
           this record — so it must not still say "not decided" after the
           destination has just been typed in. */
        OPEN = await api('GET', '/api/partner/student/' + OPEN.id);
        await refreshList();
      } catch (err) { $('#profSaid').textContent = err.message; }
      btn.disabled = false;
      setTimeout(() => { const el = $('#profSaid'); if (el) el.textContent = ''; }, 3000);
      return;
    }

    const drop = e.target.closest('[data-drop]');
    if (drop) {
      if (!confirm('Remove this colleague? They lose access immediately.')) return;
      try {
        await api('DELETE', '/api/partner/team/' + drop.dataset.drop);
        await loadTeam();
        toast('Removed.');
      } catch (err) { toast(err.message); }
    }
  });

  /* Uploads. One handler for both checklists — the slot is on the input. */
  document.addEventListener('change', async e => {
    const up = e.target.closest('[data-up]');
    if (!up || !OPEN) return;
    const f = up.files && up.files[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) return toast('That file is over 12MB.');
    const fd = new FormData();
    fd.append('key', up.dataset.up);
    fd.append('file', f);
    toast('Uploading ' + f.name + '…');
    try {
      const r = await fetch('/api/partner/student/' + OPEN.id + '/document', {
        method: 'POST', credentials: 'same-origin', body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'That upload did not go through.');
      OPEN.docs = d.docs;
      paintOne();
      await refreshList();
      toast('Uploaded. Glovels will check it.');
    } catch (err) { toast(err.message); }
  });

  $('#addOne').onclick = () => {
    const one = {
      name: $('#aName').value, email: $('#aEmail').value, phone: $('#aPhone').value,
      destination: $('#aCountry').value, level: $('#aLevel').value,
    };
    addStudents([one], $('#addOne')).then(() => {
      ['#aName', '#aEmail', '#aPhone'].forEach(id => { $(id).value = ''; });
    });
  };

  $('#addMany').onclick = () => {
    const list = parseSheet($('#bulk').value);
    if (!list.length) return said('<div class="warnbox">Paste some rows first.</div>');
    addStudents(list, $('#addMany')).then(() => { $('#bulk').value = ''; });
  };

  $('#addMate').onclick = async () => {
    const btn = $('#addMate');
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/partner/team',
        { name: $('#tName').value, email: $('#tEmail').value });
      $('#teamOut').innerHTML = '<div class="warnbox" style="border-color:#bfe0cc;'
        + 'background:#eef8f2;color:#14603a"><b>Added.</b> Their password is '
        + '<code>' + esc(r.password) + '</code> — it is also on its way to them by email, '
        + 'and they choose their own the first time they sign in. This is the only time '
        + 'it is shown.</div>';
      $('#tName').value = ''; $('#tEmail').value = '';
      await loadTeam();
    } catch (e) {
      $('#teamOut').innerHTML = '<div class="warnbox" style="border-color:#c0392b;'
        + 'background:#fdf3f2;color:#7a2118">' + esc(e.message) + '</div>';
    }
    btn.disabled = false;
  };

  $('#logoFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 300 * 1024) return toast('That image is over 300KB.');
    const fr = new FileReader();
    fr.onload = () => saveLogo(String(fr.result));
    fr.readAsDataURL(f);
  });
  $('#logoClear').onclick = () => saveLogo('');

  $('#staffOut').onclick = async e => {
    e.preventDefault();
    try { await api('POST', '/api/auth/logout'); } catch (err) { /* going anyway */ }
    location.href = 'login.html';
  };
})();
"""
