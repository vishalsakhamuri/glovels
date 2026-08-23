"""The counsellor's workspace — their caseload, and the live conversation."""

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

    <style>
      /* A fixed-width aside beside the main column. The width used to be an
         inline style, which beats the media query that collapses .p-cols on a
         narrow screen — so this page scrolled sideways on every phone. The
         width lives in a class now, and stands down under 980px. */
      .p-cols.aside{grid-template-columns:var(--aside,270px) 1fr}
      @media (max-width:980px){ .p-cols.aside{grid-template-columns:1fr} }
      @media (max-width:980px){ .p-cols.aside>*{position:static !important} }
      /* A grid child is min-width:auto by default, so one wide thing inside
         the thread — a long link, an avatar row — sets the floor for the whole
         column and the page scrolls. Nothing here needs to be wider than the
         screen. */
      .p-cols.aside>*{min-width:0}
    </style>

    <div class="p-cols aside" style="--aside:320px;align-items:start;gap:16px">

      <div class="p-card" style="padding:0;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--line);display:flex;
          align-items:center;gap:9px">
          <b style="font-size:14px;color:var(--navy-900)">My students</b>
          <span class="pill" id="caseCount" style="margin-left:auto">0</span>
        </div>
        <div style="padding:11px 13px;border-bottom:1px solid var(--line)">
          <input id="findStudent" placeholder="Search by name or email" style="width:100%;
            padding:9px 11px;font:400 13px/1.4 var(--sans);color:var(--navy-900);
            border:1.5px solid #d8dde4;border-radius:9px">
        </div>
        <div id="caseList" style="max-height:min(620px,66vh);overflow-y:auto"></div>
      </div>

      <div id="pane">
        <div class="sl-empty" style="margin:0">
          <b>Pick a student</b>
          <p>Their profile, documents, shortlist and your conversation with them all open here.
            Anything a student sends arrives without you refreshing.</p>
        </div>
      </div>
    </div>
"""

SCRIPT = r"""
let STUDENTS = [];
/* The record currently open, so the row renderer can read this student's
   application stages without every caller threading them through. */
let CASE = null;
let openId = null;
let ME = null;
let filter = '';

/* ------------------------------------------------------------------ caseload */

function row(s) {
  const initials = s.name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  const last = s.lastMessage;
  const preview = last
    ? (last.who === 'me' ? '' : 'You: ') + (last.body || 'sent a file').slice(0, 46)
    : 'No messages yet';
  return '<button type="button" data-open="' + s.id + '" style="' +
    'display:flex;gap:11px;align-items:flex-start;width:100%;text-align:left;cursor:pointer;' +
    'border:0;border-bottom:1px solid var(--line);background:' +
      (s.id === openId ? 'var(--cream)' : 'transparent') + ';padding:12px 14px">' +
    '<span style="width:34px;height:34px;border-radius:50%;flex:none;display:grid;place-items:center;' +
      'color:#fff;font:700 12px/1 var(--sans);background:linear-gradient(160deg,var(--navy-600),var(--navy-800))">' +
      esc(initials) + '</span>' +
    '<span style="flex:1;min-width:0">' +
      '<b style="display:block;font:600 13.4px/1.3 var(--sans);color:var(--navy-900)">' + esc(s.name) + '</b>' +
      '<span style="display:block;font:400 12px/1.45 var(--sans);color:var(--muted);' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(preview) + '</span>' +
      (s.package ? '<span class="sl-chip" style="margin-top:6px;display:inline-block">' + esc(s.package) + '</span>' : '') +
    '</span>' +
    '<span style="flex:none;text-align:right">' +
      (s.unread ? '<span style="display:inline-block;min-width:20px;padding:2px 6px;border-radius:99px;' +
        'background:var(--blue);color:#fff;font:800 10.5px/1.5 var(--sans)">' + s.unread + '</span>'
        : '<span style="font:400 10.5px/1.5 var(--sans);color:var(--muted)">' +
          (last ? timeAgo(last.at) : '') + '</span>') +
    '</span></button>';
}

function paintCase() {
  const q = filter.toLowerCase();
  const list = STUDENTS.filter(s =>
    !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  $('#caseCount').textContent = STUDENTS.length +
    (STUDENTS.reduce((a, s) => a + s.unread, 0) ? ' · ' + STUDENTS.reduce((a, s) => a + s.unread, 0) + ' unread' : '');
  $('#caseList').innerHTML = list.map(row).join('') ||
    '<p style="padding:20px 16px;margin:0;font-size:12.8px;color:var(--muted);line-height:1.6">' +
    (STUDENTS.length
      ? 'Nobody matches that search.'
      : 'No students are assigned to you yet. An admin assigns them from the Organisation screen.') +
    '</p>';
}

async function loadCase() {
  const r = await api('GET', '/api/staff/students');
  STUDENTS = r.students;
  ME = r.role;
  paintCase();
}

/* --------------------------------------------------------------- the record */

const money = p => p.totalInr === 0 ? '₹0 tuition'
  : '≈ ₹' + (p.totalInr / 100000).toFixed(p.totalInr % 100000 ? 1 : 0) + 'L';

function bubble(m) {
  const fromStudent = m.who === 'me';     /* 'me' is always the student's side */
  return '<div style="display:flex;gap:10px;' + (fromStudent ? '' : 'flex-direction:row-reverse') + '">' +
    '<span style="width:30px;height:30px;border-radius:50%;flex:none;display:grid;place-items:center;' +
      'color:#fff;font:700 11px/1 var(--sans);background:' +
      (fromStudent ? 'linear-gradient(160deg,var(--navy-600),var(--navy-800))'
                   : 'linear-gradient(160deg,var(--blue),var(--blue-deep))') + '">' +
      (fromStudent ? 'S' : 'You') + '</span>' +
    '<div style="max-width:70%"><div style="background:' + (fromStudent ? 'var(--cream)' : '#eaf1fd') +
      ';border:1px solid ' + (fromStudent ? 'var(--line)' : '#c2d6f5') + ';border-radius:14px;' +
      'padding:10px 13px;font-size:13.2px;line-height:1.6;color:var(--navy-800)">' +
      /* The attachment is a document on the student's file, so this opens the
         real thing rather than printing a filename at somebody. */
      (m.attachment
        ? '<a href="/api/staff/student/' + openId + '/document/' +
          encodeURIComponent(m.attachment.key) + '/file" style="display:flex;' +
          'align-items:center;gap:7px;font-weight:700;color:var(--blue-deep);' +
          'text-decoration:underline;margin-bottom:5px">' +
          ico('file') + esc(m.attachment.name) +
          (m.attachment.size ? ' <span style="font-weight:400;color:var(--muted)">\u00b7 ' +
            esc(m.attachment.size) + '</span>' : '') + '</a>'
        : '') + esc(m.t || '') + '</div>' +
      '<div style="font:400 10.4px/1.6 var(--sans);color:var(--muted);margin-top:3px;' +
        (fromStudent ? '' : 'text-align:right') + '">' + timeAgo(m.at) + '</div></div></div>';
}

function docRow(d) {
  const L = {ok: 'Verified', wait: 'In review', none: 'Not uploaded'};
  return '<li><span style="color:var(--blue-deep);display:flex">' + ico('file') + '</span>' +
    '<span style="flex:1">' + esc(d.file) + '</span>' +
    '<span class="st ' + d.status + '">' + L[d.status] + '</span>' +
    (d.status === 'wait'
      ? '<button type="button" class="btn btn-green btn-sm" data-verify="' + esc(d.key) +
        '" style="margin-left:8px">Verify</button>'
      : '<button type="button" class="btn btn-ghost btn-sm" data-unverify="' + esc(d.key) +
        '" style="margin-left:8px">Query</button>') + '</li>';
}

/* The five stages, the same five the student's own tracker draws. Kept here as
   the same list rather than a second one, because two lists that must agree
   eventually will not. */
const APP_STAGES = ['Documents collected', 'Application drafted', 'Submitted',
  'Under review', 'Decision'];

/* One row on the student's list: what it is, where it has got to, and the two
   things a counsellor does to it. */
function uniRow(p) {
  const a = (CASE && CASE.apps && CASE.apps[p.id]) || { stage: 0, outcome: '' };
  const done = a.outcome === 'offer' ? 'ok' : a.outcome === 'rejected' ? 'bad' : '';

  const options = APP_STAGES.map((n, i) =>
    '<option value="' + i + '"' + (i === Number(a.stage || 0) ? ' selected' : '') + '>' +
    esc(n) + '</option>').join('');

  return '<li style="align-items:flex-start;gap:10px">' +
    '<div style="flex:1;min-width:0">' +
      '<b style="display:block">' + esc(p.university || p.id) + '</b>' +
      '<span style="display:block;font-size:12px;color:var(--muted)">' +
        esc(p.program || '') + ' \u00b7 ' + money(p) + '</span>' +
    '</div>' +
    '<select data-stage="' + esc(p.id) + '" style="padding:6px 8px;font:600 12px/1.3 ' +
      'var(--sans);border:1.5px solid #d8dde4;border-radius:8px;background:var(--paper)">' +
      options + '</select>' +
    '<select data-outcome="' + esc(p.id) + '" style="padding:6px 8px;font:600 12px/1.3 ' +
      'var(--sans);border:1.5px solid ' + (done === 'bad' ? '#e0b4ae' : '#d8dde4') +
      ';border-radius:8px;background:var(--paper)">' +
      '<option value=""' + (!a.outcome ? ' selected' : '') + '>No decision yet</option>' +
      '<option value="offer"' + (a.outcome === 'offer' ? ' selected' : '') + '>Offer</option>' +
      '<option value="rejected"' + (a.outcome === 'rejected' ? ' selected' : '') +
        '>Rejected</option>' +
    '</select>' +
    '<button type="button" class="btn btn-ghost btn-sm" data-unidrop="' + esc(p.id) +
      '" title="Take this off their list">Remove</button>' +
    '</li>';
}

function paintRecord(r) {
  CASE = r;
  const p = r.profile || {};
  const facts = [
    ['Email', r.student.email], ['Mobile', r.student.phone || '—'],
    ['Degree', p.d_course ? p.d_course + ' · ' + (p.d_uni || '') : 'Not filled in'],
    ['CGPA', p.d_cgpa || '—'],
    ['English', p.e_test ? p.e_test + ' ' + (p.e_score || '') : 'Not taken'],
    ['Destination', p.g_country || '—'],
    ['Intake', p.g_intake || '—'],
    ['Budget', p.b_total || '—'],
  ];
  const filled = Object.values(p).filter(v => String(v || '').trim()).length;

  $('#pane').innerHTML =
    '<div class="p-card" style="margin-bottom:16px">' +
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">' +
        '<h3 style="margin:0;font-size:17px">' + esc(r.student.name) + '</h3>' +
        (r.counsellor ? '<span class="pill">' + esc(r.counsellor.name) + '</span>' : '') +
        '<span class="pill" style="margin-left:auto">' + (r.orders[0] ? esc(r.orders[0].package) : 'No package') + '</span>' +
      '</div>' +
      '<div class="out tiles" style="--tiles:4;margin:0 0 16px">' +
        '<div><b>' + r.shortlist.length + '</b><span>Shortlisted</span></div>' +
        '<div><b>' + Object.keys(r.apps).length + '</b><span>Applications</span></div>' +
        '<div><b>' + r.docs.filter(d => d.status === 'ok').length + '/' + r.docs.length + '</b><span>Docs verified</span></div>' +
        '<div><b>' + filled + '</b><span>Profile fields</span></div>' +
      '</div>' +
      '<div class="tabs" style="margin-bottom:14px">' +
        '<button class="tab" data-t="chat" aria-selected="true">' + ico('chat') + ' Conversation</button>' +
        '<button class="tab" data-t="file" aria-selected="false">' + ico('user') + ' Their file</button>' +
      '</div>' +

      '<section class="pane active" id="t-chat">' +
        /* What an administrator has said about this conversation, above the
           conversation. The student never sees it — it is not on their record
           and not in their messages. */
        (r.guidance || []).map(g =>
          '<div class="guide"><b>' + esc(g.from) + ' &middot; about this student</b>' +
          '<p>' + esc(g.body) + '</p><small>' + timeAgo(g.at) + '</small></div>').join('') +
        '<div id="thread" style="height:min(400px,46vh);overflow-y:auto;display:flex;' +
          'flex-direction:column;gap:12px;padding:4px 2px 12px"></div>' +
        '<div id="typing" style="font:400 11.6px/1.6 var(--sans);color:var(--muted);height:18px"></div>' +
        '<form id="reply" style="display:flex;gap:9px;align-items:flex-end;border-top:1px solid var(--line);' +
          'padding-top:12px">' +
          '<textarea id="rbox" rows="1" placeholder="Reply to ' + esc(r.student.name.split(" ")[0]) + '…" style="flex:1;' +
            'resize:none;max-height:130px;padding:11px 12px;font:400 13.4px/1.5 var(--sans);' +
            'color:var(--navy-900);border:1.5px solid #d8dde4;border-radius:12px"></textarea>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="rclip" ' +
            'title="Send a file">' + ico('file') + '</button>' +
          '<button type="submit" class="btn btn-primary btn-sm">Send</button>' +
        '</form>' +
        '<p id="rfile" style="margin:7px 0 0;font:600 12.2px/1.5 var(--sans);' +
          'color:var(--muted)"></p>' +
        '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">' +
          ['I have your documents — I will confirm your shortlist on a call tomorrow.',
           'Please start the APS certificate this week. It takes 6–8 weeks and blocks the German application.',
           'Your transcripts are verified. Next: the blocked account.',
           'I have added two more universities to your shortlist — have a look and tell me what you think.']
            .map(q => '<button type="button" class="btn btn-ghost btn-sm" data-canned="' + esc(q) + '">' +
              esc(q.slice(0, 34)) + '…</button>').join('') +
        '</div>' +
      '</section>' +

      '<section class="pane" id="t-file">' +
        '<div class="p-cols" style="align-items:start">' +
          '<div><h3 style="font-size:14.5px;margin-bottom:10px">Profile</h3>' +
            '<ul class="doclist">' + facts.map(([k, v]) =>
              '<li><span style="color:var(--muted);min-width:92px">' + esc(k) + '</span>' +
              '<span class="st none" style="margin-left:auto;max-width:60%;text-transform:none;' +
              'letter-spacing:0;font-weight:600">' + esc(v) + '</span></li>').join('') + '</ul></div>' +
          '<div><h3 style="font-size:14.5px;margin-bottom:10px">Documents</h3>' +
            '<ul class="doclist" id="docs">' + (r.docs.length ? r.docs.map(docRow).join('')
              : '<li><span>Nothing uploaded yet</span></li>') + '</ul></div>' +
        '</div>' +
        /* The list, and the controls that run it. This is the counsellor's
           actual job: agree a shortlist on a call, put it here, and move each
           one along as it goes. Before this the student had to add their own
           universities from a finder, having just been told which ones over
           the phone — and the five-stage tracker on their screen sat at zero
           for everybody, because nothing could move it. */
        '<div style="display:flex;align-items:baseline;gap:10px;margin:18px 0 10px">' +
          '<h3 style="font-size:14.5px;margin:0">Their universities</h3>' +
          '<span style="font-size:11.8px;color:var(--muted)">' + r.shortlist.length +
            ' on the list</span>' +
          '<button type="button" class="btn btn-primary btn-sm" id="addUni" ' +
            'style="margin-left:auto">+ Add a university</button></div>' +
        '<div id="uniAdd" hidden style="margin:0 0 12px;padding:12px 14px;border-radius:11px;' +
          'background:var(--paper);border:1px solid var(--line)">' +
          '<input id="uniQ" placeholder="Search the catalogue — university, course or country" ' +
            'style="width:100%;padding:9px 11px;font:400 13px/1.4 var(--sans);' +
            'border:1.5px solid #d8dde4;border-radius:9px">' +
          '<div id="uniHits" style="margin-top:9px;max-height:260px;overflow-y:auto"></div></div>' +
        (r.shortlist.length
          ? '<ul class="doclist" id="uniList">' + r.shortlist.map(uniRow).join('') + '</ul>'
          : '<p style="font-size:12.8px;color:var(--muted)" id="uniList">Nothing on their list ' +
            'yet. Agree one on a call, then put it here \u2014 this is what the admission ' +
            'guarantee attaches to.</p>') +

        /* The drafts the student wrote in the studio. This is the copy the
           rewrite is billed against, so it belongs on the counsellor's screen
           rather than in an email the student has to be asked for. */
        '<h3 style="font-size:14.5px;margin:18px 0 10px">Drafts from the studio' +
          (r.drafts && r.drafts.length
            ? ' <span class="st none" style="text-transform:none;letter-spacing:0">' +
              r.drafts.length + '</span>' : '') + '</h3>' +
        ((r.drafts && r.drafts.length)
          ? r.drafts.slice(0, 6).map((d, i) =>
              '<details' + (i === 0 ? ' open' : '') + ' style="border:1px solid var(--line);' +
                'border-radius:10px;padding:10px 13px;margin-bottom:8px;background:var(--paper)">' +
              '<summary style="cursor:pointer;font:700 12.8px/1.5 var(--sans);color:var(--navy-900)">' +
                (d.kind === 'lor' ? 'Letter of recommendation' : 'Statement of purpose') +
                ' \u00b7 ' + esc(d.programme || 'no programme given') +
                (d.university ? ', ' + esc(d.university) : '') +
                ' <span style="font-weight:600;color:var(--muted)">' + d.words + ' words, ' +
                timeAgo(d.at) + '</span></summary>' +
              d.paragraphs.map(t => '<p style="margin:11px 0 0;font-size:13px;line-height:1.7">' +
                esc(t) + '</p>').join('') +
              '<p style="margin:12px 0 0;font-size:11.6px;color:var(--muted)">' +
                esc(d.caveat) + '</p></details>').join('')
          : '<p style="font-size:12.8px;color:var(--muted)">They have not written one yet. ' +
            'The studio is on the home page, under the SOP and LOR cards.</p>') +
      '</section>' +
    '</div>';

  const th = $('#thread');
  th.innerHTML = r.msgs.map(bubble).join('');
  th.scrollTop = th.scrollHeight;

  const box = $('#rbox');
  box.addEventListener('input', () => {
    box.style.height = 'auto';
    box.style.height = Math.min(130, box.scrollHeight) + 'px';
    ping();
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#reply').requestSubmit(); }
  });
  if ($('#rclip')) {
    const pick = document.createElement('input');
    pick.type = 'file';
    pick.accept = '.pdf,.jpg,.jpeg,.png,.heic,.doc,.docx,image/*,application/pdf';
    pick.style.display = 'none';
    document.body.appendChild(pick);
    pick.addEventListener('change', () => {
      const f = pick.files[0];
      pick.value = '';
      if (f) sendFile(f);
    });
    $('#rclip').onclick = () => pick.click();
  }
  $('#reply').addEventListener('submit', async e => {
    e.preventDefault();
    const v = box.value.trim();
    if (!v) return;
    box.value = '';
    box.style.height = 'auto';
    await sendReply(v);
  });
  box.focus();
}

/* Typing hints are throttled: one every 1.5s is enough to show the dots, and
   one per keystroke would be a request per character. */
let lastPing = 0;
/* ------------------------------------------- running the student's list */

const refreshCase = async () => {
  if (openId) paintRecord(await api('GET', '/api/staff/student/' + openId));
};

/* The catalogue, fetched once and searched in the browser. It is 171 rows —
   small enough that a round trip per keystroke would be the slower answer. */
let CATALOGUE = null;
async function catalogue() {
  if (!CATALOGUE) {
    const d = await api('GET', '/api/staff/catalogue');
    /* Only what is actually on offer. Offering a counsellor a university that
       has been switched off is offering them a row the student will never be
       able to see. */
    CATALOGUE = (d.programmes || []).filter(p => p.active !== false);
  }
  return CATALOGUE;
}

let uniTimer = null;
async function searchUnis(q) {
  const box = $('#uniHits');
  const term = q.trim().toLowerCase();
  if (term.length < 2) {
    box.innerHTML = '<p style="margin:0;font-size:12.2px;color:var(--muted)">' +
      'Type two letters or more.</p>';
    return;
  }
  const all = await catalogue();
  const on = new Set(((CASE && CASE.shortlist) || []).map(x => String(x.id)));
  const hits = all.filter(p =>
    ((p.university || '') + ' ' + (p.program || '') + ' ' + (p.country || ''))
      .toLowerCase().includes(term)).slice(0, 24);

  box.innerHTML = hits.length
    ? '<ul class="doclist" style="margin:0">' + hits.map(p =>
        '<li><div style="flex:1;min-width:0"><b style="display:block">' +
        esc(p.university || p.id) + '</b><span style="display:block;font-size:11.8px;' +
        'color:var(--muted)">' + esc(p.name || p.program || '') + ' \u00b7 ' +
        esc(p.country || '') + '</span></div>' +
        (on.has(String(p.id))
          ? '<span class="st ok">on their list</span>'
          : '<button type="button" class="btn btn-primary btn-sm" data-uniadd="' +
            esc(p.id) + '">Add</button>') + '</li>').join('') + '</ul>'
    : '<p style="margin:0;font-size:12.2px;color:var(--muted)">Nothing matches that.</p>';
}

document.addEventListener('input', e => {
  if (e.target && e.target.id === 'uniQ') {
    clearTimeout(uniTimer);
    uniTimer = setTimeout(() => searchUnis(e.target.value), 220);
  }
});

document.addEventListener('change', async e => {
  const st = e.target.closest('[data-stage]');
  const oc = e.target.closest('[data-outcome]');
  if (!st && !oc) return;
  const id = (st || oc).dataset.stage || (st || oc).dataset.outcome;
  const row = e.target.closest('li');
  const stage = Number((row.querySelector('[data-stage]') || {}).value || 0);
  const outcome = (row.querySelector('[data-outcome]') || {}).value || '';
  try {
    const r = await api('PUT', '/api/staff/student/' + openId + '/application/' +
      encodeURIComponent(id), { stage, outcome });
    if (r.moved) toast('The student has been told.');
    await refreshCase();
  } catch (err) {
    alert(err.message || 'That did not save.');
  }
});

document.addEventListener('click', async e => {
  const open = e.target.closest('#addUni');
  if (open) {
    const box = $('#uniAdd');
    box.hidden = !box.hidden;
    if (!box.hidden) { $('#uniQ').focus(); searchUnis($('#uniQ').value || ''); }
    return;
  }

  const add = e.target.closest('[data-uniadd]');
  if (add) {
    add.disabled = true;
    try {
      await api('POST', '/api/staff/student/' + openId + '/shortlist',
        { id: add.dataset.uniadd });
      await refreshCase();
      /* The panel stays open — a counsellor agreeing a shortlist on a call is
         adding five, not one. */
      $('#uniAdd').hidden = false;
      searchUnis($('#uniQ').value || '');
      toast('Added, and the student has been told.');
    } catch (err) {
      add.disabled = false;
      alert(err.message || 'That did not add.');
    }
    return;
  }

  const drop = e.target.closest('[data-unidrop]');
  if (drop) {
    /* No confirm dialog: it is one row, it is reversible by adding it back, and
       a dialog on every remove makes agreeing a shortlist of ten a chore. */
    drop.disabled = true;
    try {
      await api('DELETE', '/api/staff/student/' + openId + '/shortlist/' +
        encodeURIComponent(drop.dataset.unidrop));
      await refreshCase();
      toast('Taken off their list.');
    } catch (err) {
      drop.disabled = false;
      alert(err.message || 'That did not remove.');
    }
  }
});

function ping() {
  const now = Date.now();
  if (now - lastPing < 1500 || !openId) return;
  lastPing = now;
  api('POST', '/api/staff/student/' + openId + '/typing').catch(() => {});
}

/*
 * A file, sent to the student.
 *
 * It goes on their file at the same moment — an offer letter that exists only
 * inside a chat thread is one nobody can find when the visa appointment comes
 * round.
 */
async function sendFile(f) {
  const note = $('#rfile');
  if (f.size > 10 * 1024 * 1024) {
    note.textContent = 'That file is over 10 MB.';
    return;
  }
  note.textContent = 'Sending ' + f.name + '\u2026';
  try {
    const form = new FormData();
    form.append('file', f, f.name);
    const body = $('#rbox') ? $('#rbox').value.trim() : '';
    if (body) form.append('body', body);
    const r = await fetch('/api/staff/student/' + openId + '/attach',
      { method: 'POST', credentials: 'same-origin', body: form });
    const d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || 'That did not go through.');
    if ($('#rbox')) { $('#rbox').value = ''; }
    /* The whole record, not just the thread: the file is now on their Their
       file tab as well, and a screen that shows it in one place and not the
       other is the screen somebody stops believing. The Conversation tab is
       where they were, so that is where they stay. */
    paintRecord(await api('GET', '/api/staff/student/' + openId));
    const th = $('#thread');
    if (th) th.scrollTop = th.scrollHeight;
    const note2 = $('#rfile');
    if (note2) {
      note2.textContent = 'Sent. It is on their file too.';
      setTimeout(function () { if (note2) note2.textContent = ''; }, 5000);
    }
  } catch (e) {
    note.textContent = 'Not sent: ' + e.message;
  }
}

async function sendReply(body) {
  const th = $('#thread');
  try {
    const r = await api('POST', '/api/staff/student/' + openId + '/message', { body });
    th.insertAdjacentHTML('beforeend', bubble(r.msg));
    th.scrollTop = th.scrollHeight;
    const s = STUDENTS.find(x => x.id === openId);
    if (s) { s.lastMessage = { who: 'them', body, at: r.msg.at }; s.unread = 0; paintCase(); }
  } catch (e) {
    toast('That did not send: ' + e.message);
  }
}

async function open(id) {
  openId = id;
  paintCase();
  $('#pane').innerHTML = '<div class="p-card"><p style="margin:0;color:var(--muted)">Opening…</p></div>';
  try {
    paintRecord(await api('GET', '/api/staff/student/' + id));
    const s = STUDENTS.find(x => x.id === id);
    if (s) { s.unread = 0; paintCase(); }
  } catch (e) {
    $('#pane').innerHTML = '<div class="sl-empty"><b>Could not open that record</b><p>' + esc(e.message) + '</p></div>';
  }
}

/* --------------------------------------------------------------- behaviour */

document.addEventListener('click', async e => {
  const o = e.target.closest('[data-open]');
  if (o) return open(Number(o.dataset.open));

  const t = e.target.closest('.tab[data-t]');
  if (t) {
    $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
    $$('#pane .pane').forEach(x => x.classList.toggle('active', x.id === 't-' + t.dataset.t));
    return;
  }
  const c = e.target.closest('[data-canned]');
  if (c) { $('#rbox').value = c.dataset.canned; $('#rbox').focus(); return; }

  const v = e.target.closest('[data-verify]') || e.target.closest('[data-unverify]');
  if (v && openId) {
    const key = v.dataset.verify || v.dataset.unverify;
    const status = v.dataset.verify ? 'ok' : 'wait';
    try {
      await api('POST', '/api/staff/student/' + openId + '/document/' + encodeURIComponent(key), { status });
      toast(status === 'ok' ? 'Marked verified — the student sees it straight away.'
                            : 'Sent back for another look.');
      paintRecord(await api('GET', '/api/staff/student/' + openId));
      $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.t === 'file')));
      $$('#pane .pane').forEach(x => x.classList.toggle('active', x.id === 't-file'));
    } catch (err) { toast(err.message); }
  }
});

$('#findStudent').addEventListener('input', e => { filter = e.target.value; paintCase(); });

/* ------------------------------------------------------------------- boot */

staffBoot(async me => {
  await loadCase();

  connectLive({
    message(d) {
      /* Someone wrote. If their conversation is open, drop it straight into the
         thread; otherwise bump their unread count so it is visible in the list. */
      const s = STUDENTS.find(x => x.id === d.studentId);
      if (s) {
        s.lastMessage = { who: d.msg.who, body: d.msg.t, at: d.msg.at };
        if (d.studentId !== openId && d.msg.who === 'me') s.unread = (s.unread || 0) + 1;
        paintCase();
      } else {
        loadCase();      // a student who was just assigned to us
      }
      if (d.studentId === openId && d.msg.who === 'me') {
        const th = $('#thread');
        if (th) {
          th.insertAdjacentHTML('beforeend', bubble(d.msg));
          th.scrollTop = th.scrollHeight;
        }
      }
    },
    typing(d) {
      if (d.studentId !== openId) return;
      const el = $('#typing');
      if (!el) return;
      el.textContent = (d.from || 'They').split(' ')[0] + ' is typing…';
      clearTimeout(el._h);
      el._h = setTimeout(() => { el.textContent = ''; }, 2500);
    },
  });

  /* Deep link: /counsellor?student=3 opens straight into that conversation. */
  const want = Number(new URLSearchParams(location.search).get('student'));
  if (want && STUDENTS.some(s => s.id === want)) open(want);
  else if (STUDENTS.length === 1) open(STUDENTS[0].id);
});
"""
