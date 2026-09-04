"""Documents — upload cards with drag-and-drop, per-file status and a readiness ring."""

from portal_fields import DOCS_JS

BODY = """
    <div class="p-cols" style="margin-bottom:20px;align-items:start">
      <div class="p-card">
        <h3>Document readiness</h3>
        <div class="ring-row">
          <svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="bg" cx="50" cy="50" r="42"></circle>
            <circle class="fg" id="ringFg" cx="50" cy="50" r="42"
              stroke-dasharray="264" stroke-dashoffset="264"></circle>
            <text class="ring-lbl" id="ringTxt" x="50" y="56" text-anchor="middle">0%</text>
          </svg>
          <div>
            <p style="margin:0 0 6px;font-size:13.4px;color:var(--navy-900);font-weight:600"
               id="ringHead">Nothing uploaded yet</p>
            <p style="margin:0;font-size:12.4px;color:var(--muted);line-height:1.55">A file is
              <b>verified</b> once your counsellor has opened it and confirmed it is readable, current
              and matches your profile. Uploading is not the same as being ready.</p>
          </div>
        </div>
      </div>
      <div class="p-card">
        <h3>What blocks what</h3>
        <ul class="doclist" id="blockList"></ul>
      </div>
    </div>

    <div class="p-sec">
      <!-- No "Simulate counsellor verification" here. It was a link on this
           line, it worked, and one press moved every waiting file to verified —
           on the student's own screen, against their own file, deciding the
           thing this page defines as somebody else having looked. -->
      <div class="p-sec-head"><h2>Your documents</h2></div>
      <!-- Said before they choose a file, not after the upload fails. Both the
           number and the list of types are written by the script from the one
           constant each, so the screen and the server can never disagree about
           them again. -->
      <p class="doclimit" id="docLimit">PDF, a photo or Word. One file per
        document, up to <b>10 MB</b> each.</p>
      <div class="sl-grid" id="docGrid" style="grid-template-columns:repeat(auto-fill,minmax(290px,1fr))"></div>

      <!-- Anything sent in the conversation. It is a document like any other —
           same folder, same download — but it does not belong to one of the
           twelve cards above, so it would otherwise be uploaded and then
           invisible. -->
      <section id="sharedWrap" hidden style="margin-top:26px">
        <h2 style="font:700 16.4px/1.3 var(--disp,inherit);color:var(--navy-900);margin:0 0 4px">
          Shared in your conversation</h2>
        <p style="margin:0 0 14px;font-size:12.8px;color:var(--muted);line-height:1.6">
          Files you and your counsellor have sent each other. They are on your file, so
          nobody has to scroll back through messages to find one.</p>
        <ul class="doclist" id="sharedList" style="gap:8px"></ul>
      </section>
    </div>

    <style>
      /* The sentence under a document's name: how it should arrive, not what it
         is. Small, but not grey-on-grey — it is the part students get wrong. */
      .docnote{margin:8px 0 0;font:400 12px/1.6 var(--sans);color:var(--navy-800);
        background:#f5f8fc;border-left:3px solid var(--navy-600,#1c4d78);
        border-radius:0 8px 8px 0;padding:8px 11px}
      /* Every file in one slot. Compact, because eight semester marksheets in
         a card that is 290px wide is the case this has to survive. */
      .dfiles{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:5px}
      .dfiles li{display:flex;align-items:center;gap:7px;font:400 12px/1.4 var(--sans);
        color:var(--navy-800);min-width:0}
      .dfiles a{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dfiles .dsize{flex:none;font-size:11px;color:var(--muted)}
      .dfiles .ico{flex:none;color:var(--green-deep,#278a58)}
      .dfiles .dxf{flex:none;appearance:none;border:0;background:none;cursor:pointer;
        font:700 11px/1 var(--sans);color:var(--muted);text-decoration:underline;
        text-underline-offset:2px;padding:2px}
      .dfiles .dxf:hover{color:#7a2118}
      /* What a status means, when it means something to do about it. */
      .docsay{margin:9px 0 0;font:400 12px/1.55 var(--sans);color:#5b4409;
        background:#fdf6e6;border:1px solid #e6d5a8;border-radius:9px;padding:8px 10px}
      .doclimit{margin:0 0 14px;font:400 12.5px/1.6 var(--sans);color:var(--muted)}
      .doclimit b{color:var(--navy-900)}
    </style>

    <div class="warnbox" style="background:#fdf6e6;border:1px solid #e6d5a8;color:#5b4409;
      border-radius:12px;padding:13px 15px;font-size:12.8px;line-height:1.55;display:flex;gap:9px">
      <svg class="ico" aria-hidden="true"><use href="#i-info"/></svg><span>Your files are stored on the
      Glovels server, not in your browser. Nothing is uploaded
      anywhere on the internet — they are written to <code>data/uploads/</code> beside the server,
      under your own account, and can only be read back by you while signed in. On the live portal
      the same endpoint reads from encrypted storage and only your assigned counsellor can open
      them.</span>
    </div>
"""

SCRIPT = r"""
/* Each document says what it BLOCKS, not just what it is. A student who knows
   the APS certificate holds up the whole German application chases it; a
   student looking at a list of nouns does not. */
""" + DOCS_JS + r"""
/* Documents are real uploads. The file itself is written to disk on the server
   under this student's own folder and is never served as a static asset — it
   comes back only through an endpoint that resolves the student from the
   session, so one student cannot fetch another's passport by guessing a URL.
   DB.docs holds only the metadata needed to draw the card. */
DB.docs = DB.docs || {};
/* THREE ANSWERS, not two.
 *
 * "In the status of the document, keep the options as in review, upload a
 * scanned copy or accepted."
 *
 * `rescan` is the one that was missing and the one that does the work. A
 * photograph of a certificate taken at an angle is not rejected and it is not
 * accepted — and with only those two states a counsellor had to choose one and
 * say the rest in a message the student may never open. Now the card itself
 * says it, on the document it is about.
 *
 * "Accepted" rather than "Verified", because that is the counsellors' own
 * word for it and the two mean the same thing here. */
const S = {NONE:'none', REVIEW:'wait', RESCAN:'rescan', OK:'ok'};
const LABEL = {none:'Not uploaded', wait:'In review',
               rescan:'Send a scanned copy', ok:'Accepted'};
/* What the student should DO about each, said on the card. A status nobody can
   act on is a status that sits there. */
const SAYS = {
  rescan: 'Your counsellor could not read this one. Send a proper scan rather '
        + 'than a photograph, or a clearer picture in good light.',
};

function stOf(id) { return (DB.docs[id] && DB.docs[id].status) || S.NONE; }

/* Every document that is not one of the twelve cards: the ones sent in the
   conversation. A file uploaded through the chat and shown nowhere on this
   screen is a file the student cannot find again. */
const KNOWN = new Set(DOCS.map(d => d.id));

/* The visa file has its own screen and its own cards. Its keys live in the
   same document store — one mechanism, not two — so without this every visa
   upload would also turn up here under "shared in the conversation", which is
   both wrong and the sort of duplicate that makes a student ask whether they
   have uploaded the same thing twice. */
const isVisaDoc = k => /^visa-/.test(k);

function paintShared() {
  const extra = Object.keys(DB.docs || {})
    .filter(k => !KNOWN.has(k) && !isVisaDoc(k));
  const wrap = $('#sharedWrap');
  if (!wrap) return;
  wrap.hidden = !extra.length;
  if (!extra.length) return;
  /* Newest first. The keys carry the time they were made, which is what makes
     this a sort rather than a guess. */
  extra.sort().reverse();
  $('#sharedList').innerHTML = extra.map(k => {
    const rec = DB.docs[k];
    return '<li><span style="color:var(--blue-deep);display:flex">' + ico('file') + '</span>' +
      '<span style="flex:1"><a href="/api/documents/' + encodeURIComponent(k) +
        '/file" style="color:var(--blue-deep);font-weight:600">' + esc(rec.file) + '</a>' +
        '<span style="display:block;font-size:11.6px;color:var(--muted)">' + esc(rec.size) +
        '</span></span>' +
      '<span class="st ' + rec.status + '">' + LABEL[rec.status] + '</span></li>';
  }).join('');
}

function card(d) {
  const rec = DB.docs[d.id];
  const st = stOf(d.id);
  return '<div class="sl" data-id="' + d.id + '" style="gap:0">' +
    '<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">' +
      '<span style="color:var(--blue-deep);display:flex">' + ico('file') + '</span>' +
      '<h3 style="margin:0;flex:1">' + esc(d.name) + '</h3>' +
      '<span class="st ' + st + '" style="font:700 9.6px/1 var(--sans);letter-spacing:.08em;' +
      'text-transform:uppercase;padding:4px 7px;border-radius:var(--r-pill);white-space:nowrap">' +
      LABEL[st] + '</span>' +
    '</div>' +
    '<div class="city">Blocks: ' + esc(d.blocks) + '</div>' +
    (d.note ? '<p class="docnote">' + esc(d.note) + '</p>' : '') +
    /* What the status MEANS, when it means something to do. */
    (SAYS[st] ? '<p class="docsay">' + esc(SAYS[st]) + '</p>' : '') +
    /* EVERY FILE IN THE SLOT, oldest first — the order a set was sent in.
     *
     * A slot used to hold one document and a second upload replaced the first.
     * Eight semester marksheets are eight files, and telling a student to merge
     * them into one PDF is asking them to do a job with software they do not
     * have. Each one is downloadable and each one can be taken off on its own;
     * the SLOT keeps a single status, so a set is checked as the one thing it
     * is and cannot end up half accepted. */
    (rec && rec.files && rec.files.length
      ? '<ul class="dfiles">' + rec.files.map((f, i) =>
          '<li>' + ico('check') +
          '<a href="/api/documents/file/' + encodeURIComponent(f.id) + '" ' +
            'style="color:var(--blue-deep);font-weight:600">' + esc(f.file) + '</a>' +
          '<span class="dsize">' + esc(f.size) + '</span>' +
          '<button type="button" class="dxf" data-dropfile="' + esc(f.id) + '" ' +
            'aria-label="Remove ' + esc(f.file) + '">Remove</button>' +
          '</li>').join('') + '</ul>'
      : '') +
    /* Reachable by keyboard, and announced as what it is.
     *
     * "The student can click and choose the file to upload, however the
     * student cannot press Tab and move to the next document or the next
     * action." It was a bare <div>: not in the tab order at all, so somebody
     * working without a mouse — or with a screen reader, or with a broken
     * trackpad — could reach the whole of this screen except the one control
     * on it that does anything.
     *
     * tabindex, role and aria-label make it a button to every assistive
     * technology; the Enter and Space handlers below make it one in fact. */
    '<div class="drop" tabindex="0" role="button" aria-label="' +
      esc((stOf(d.id) === S.NONE ? 'Upload ' : 'Add another file to ') + d.name) +
      '" data-drop="' + d.id + '" style="margin-top:12px;border:1.5px dashed ' +
      (st === S.NONE ? '#cfd6de' : '#bfe0cc') + ';border-radius:12px;padding:14px;text-align:center;' +
      'cursor:pointer;font:600 12.2px/1.4 var(--sans);color:var(--muted);transition:.16s">' +
      (st === S.NONE ? 'Drop a file here, or click to choose'
                     : 'Add another file') +
    '</div>' +
    (rec ? '<button type="button" class="btn btn-ghost btn-sm" data-rm="' + d.id +
      '" style="margin-top:9px">Remove</button>' : '') +
    (d.need ? '' : '<span class="sl-chip" style="width:fit-content">If available</span>') +
    '</div>';
}

function required() { return DOCS.filter(d => d.need); }

function paint() {
  $('#docGrid').innerHTML = DOCS.map(card).join('');
  paintShared();
  const req = required();
  const ok = req.filter(d => stOf(d.id) === S.OK).length;
  const up = req.filter(d => stOf(d.id) !== S.NONE).length;
  const pct = Math.round(ok / req.length * 100);
  const C = 2 * Math.PI * 42;
  $('#ringFg').setAttribute('stroke-dasharray', C);
  $('#ringFg').setAttribute('stroke-dashoffset', C * (1 - pct / 100));
  $('#ringTxt').textContent = pct + '%';
  $('#ringHead').textContent = pct === 100 ? 'Every required document is verified'
    : ok + ' of ' + req.length + ' verified · ' + (up - ok) + ' waiting on your counsellor';
  $('#blockList').innerHTML = DOCS.filter(d => stOf(d.id) !== S.OK).map(d =>
    '<li>' + ico('clock') + ' <span>' + esc(d.blocks) + '</span>' +
    '<span class="st ' + stOf(d.id) + '">' + esc(d.name) + '</span></li>').join('')
    || '<li>' + ico('check') + ' <span>Nothing is blocked. Your file is complete.</span></li>';
  DB.docsPct = pct;
}

async function accept(id, file) {
  /* The SERVER's limit, not a friendlier one. This check refused at 20 MB while
     the server refused at 10, so a student with a 15 MB scan watched the whole
     upload finish and was then told it was too big — a check that lets through
     exactly the files the real one rejects is worse than no check. */
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    toast('That file is ' + (file.size / 1048576).toFixed(1) + ' MB, and '
      + MAX_UPLOAD_MB + ' MB is the limit. Photograph the pages rather than '
      + 'scanning them at full size, or save it as a PDF.');
    return;
  }
  /* And the TYPE, said here for the same reason the size is: so somebody who
     picked the wrong file is told before waiting for an upload. The server
     checks the bytes as well, which this cannot — a .txt renamed .pdf gets
     past a check on the name and never past the one on the server. */
  const wrong = notOurType(file.name);
  if (wrong) { toast(wrong, 'bad'); return; }
  if (!ONLINE) { toast('Cannot upload while the server is not running.'); return; }
  const fd = new FormData();
  fd.append('key', id);
  fd.append('file', file, file.name);
  const card = $('[data-id="' + id + '"] .drop');
  if (card) card.textContent = 'Uploading ' + file.name + '…';
  try {
    const r = await api('POST', '/api/documents', fd, true);
    DB.docs = r.docs;
    paint();
    toast(file.name + ' uploaded — your counsellor reviews it next.');
  } catch (e) {
    paint();
    toast('That upload did not go through: ' + e.message);
  }
}

/* One hidden input, reused. A file input per card is twelve inputs to keep in
   sync with the grid every time it re-renders. */
const picker = document.createElement('input');
picker.type = 'file';
picker.style.display = 'none';
picker.accept = UPLOAD_ACCEPT;
document.body.appendChild(picker);
let pickFor = null;
picker.addEventListener('change', () => {
  if (pickFor && picker.files[0]) accept(pickFor, picker.files[0]);
  picker.value = '';
});

/* Enter and Space open the file chooser, which is what a button does. Space is
   prevented from scrolling the page, which is what it would otherwise do while
   the focus is on a div. */
$('#docGrid').addEventListener('keydown', e => {
  const dz = e.target.closest('[data-drop]');
  if (!dz || (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar')) return;
  e.preventDefault();
  pickFor = dz.dataset.drop;
  picker.click();
});

/* And the focus ring, because a control you can tab to and cannot see the
   focus on is a control you can only use by counting. */
$('#docGrid').addEventListener('focusin', e => {
  const dz = e.target.closest('[data-drop]');
  if (dz) { dz.style.borderColor = 'var(--blue)'; dz.style.background = '#f2f6fd'; }
});
$('#docGrid').addEventListener('focusout', e => {
  const dz = e.target.closest('[data-drop]');
  if (dz) { dz.style.borderColor = ''; dz.style.background = ''; }
});

$('#docGrid').addEventListener('click', e => {
  /* ONE FILE out of a set, leaving the rest. Ahead of the whole-slot remove
     below, and ahead of the drop card it sits inside — a press on Remove must
     not also open the file chooser. */
  const one = e.target.closest('[data-dropfile]');
  if (one) {
    e.preventDefault();
    e.stopPropagation();
    api('DELETE', '/api/documents/file/' + encodeURIComponent(one.dataset.dropfile))
      .then(r => { DB.docs = r.docs; paint(); toast('Removed that file.'); })
      .catch(() => toast('Could not remove that file.'));
    return;
  }
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    const key = rm.dataset.rm;
    delete DB.docs[key];
    paint();
    api('DELETE', '/api/documents/' + encodeURIComponent(key))
      .then(r => { DB.docs = r.docs; paint(); toast('Removed.'); })
      .catch(() => toast('Could not remove that file.'));
    return;
  }
  const dz = e.target.closest('[data-drop]');
  if (dz) { pickFor = dz.dataset.drop; picker.click(); }
});
['dragenter','dragover'].forEach(ev =>
  $('#docGrid').addEventListener(ev, e => {
    const dz = e.target.closest('[data-drop]');
    if (!dz) return;
    e.preventDefault();
    dz.style.borderColor = 'var(--blue)';
    dz.style.background = '#f2f6fd';
  }));
['dragleave','drop'].forEach(ev =>
  $('#docGrid').addEventListener(ev, e => {
    const dz = e.target.closest('[data-drop]');
    if (!dz) return;
    e.preventDefault();
    dz.style.borderColor = '';
    dz.style.background = '';
    if (ev === 'drop' && e.dataTransfer.files[0]) accept(dz.dataset.drop, e.dataTransfer.files[0]);
  }));

/* Written rather than typed into the markup, so the screen states the limit and
   the types the uploader actually enforces. */
(function () {
  const el = $('#docLimit');
  if (el) el.innerHTML = UPLOAD_SAYS + '. Up to <b>' + MAX_UPLOAD_MB
    + ' MB</b> each, and you can add several files to one document — every '
    + 'semester marksheet, for instance. Your counsellor checks the set as one.';
}());

paint();
"""
