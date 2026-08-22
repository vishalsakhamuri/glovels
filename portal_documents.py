"""Documents — upload cards with drag-and-drop, per-file status and a readiness ring."""

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
      <div class="p-sec-head"><h2>Your documents</h2>
        <a href="#" id="verifyAll">Simulate counsellor verification</a></div>
      <div class="sl-grid" id="docGrid" style="grid-template-columns:repeat(auto-fill,minmax(290px,1fr))"></div>
    </div>

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
const DOCS = [
  {id:'passport', name:'Passport',              need:1, blocks:'Visa appointment, university application'},
  {id:'x',        name:'Class 10 marksheet',    need:1, blocks:'University application'},
  {id:'xii',      name:'Class 12 marksheet',    need:1, blocks:'University application'},
  {id:'degree',   name:'Degree transcripts',    need:1, blocks:'University application, APS'},
  {id:'provis',   name:'Provisional / degree certificate', need:0, blocks:'Final admission'},
  {id:'english',  name:'English test scorecard',need:1, blocks:'University application, visa'},
  {id:'cv',       name:'Academic CV',           need:1, blocks:'University application'},
  {id:'sop',      name:'Statement of Purpose',  need:1, blocks:'University application'},
  {id:'lor',      name:'Letters of Recommendation', need:1, blocks:'University application'},
  {id:'finance',  name:'Financial documents',   need:1, blocks:'Visa, blocked account'},
  {id:'photo',    name:'Passport photograph',   need:0, blocks:'Visa appointment'},
  {id:'aps',      name:'APS certificate (Germany)', need:0, blocks:'German application — 6–8 weeks, start early'}
];

/* Documents are real uploads. The file itself is written to disk on the server
   under this student's own folder and is never served as a static asset — it
   comes back only through an endpoint that resolves the student from the
   session, so one student cannot fetch another's passport by guessing a URL.
   DB.docs holds only the metadata needed to draw the card. */
DB.docs = DB.docs || {};
const S = {NONE:'none', REVIEW:'wait', OK:'ok'};
const LABEL = {none:'Not uploaded', wait:'In review', ok:'Verified'};

function stOf(id) { return (DB.docs[id] && DB.docs[id].status) || S.NONE; }

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
    (rec ? '<div class="sl-meta" style="margin-top:10px">' + ico('check') +
      ' <a href="/api/documents/' + encodeURIComponent(d.id) + '/file" style="color:var(--blue-deep);' +
      'font-weight:600">' + esc(rec.file) + '</a> · ' + rec.size + '</div>' : '') +
    '<div class="drop" data-drop="' + d.id + '" style="margin-top:12px;border:1.5px dashed ' +
      (st === S.NONE ? '#cfd6de' : '#bfe0cc') + ';border-radius:12px;padding:14px;text-align:center;' +
      'cursor:pointer;font:600 12.2px/1.4 var(--sans);color:var(--muted);transition:.16s">' +
      (st === S.NONE ? 'Drop a file here, or click to choose'
                     : 'Replace this file') +
    '</div>' +
    (rec ? '<button type="button" class="btn btn-ghost btn-sm" data-rm="' + d.id +
      '" style="margin-top:9px">Remove</button>' : '') +
    (d.need ? '' : '<span class="sl-chip" style="width:fit-content">Optional</span>') +
    '</div>';
}

function required() { return DOCS.filter(d => d.need); }

function paint() {
  $('#docGrid').innerHTML = DOCS.map(card).join('');
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
  if (file.size > 20 * 1024 * 1024) {
    toast('That file is over 20 MB. Please compress it or send a smaller scan.');
    return;
  }
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
picker.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
document.body.appendChild(picker);
let pickFor = null;
picker.addEventListener('change', () => {
  if (pickFor && picker.files[0]) accept(pickFor, picker.files[0]);
  picker.value = '';
});

$('#docGrid').addEventListener('click', e => {
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

/* Stands in for the counsellor opening each file and confirming it. The server
   makes the change, because in production this is the counsellor's action on
   their own screen — not something a student can do to their own file. */
$('#verifyAll').addEventListener('click', async e => {
  e.preventDefault();
  try {
    const r = await api('POST', '/api/documents/verify-all');
    DB.docs = r.docs;
    paint();
    toast(r.verified ? r.verified + ' document' + (r.verified > 1 ? 's' : '') + ' marked verified.'
                     : 'Nothing is waiting for review.');
  } catch (err) { toast('Could not reach the server.'); }
});

paint();
"""
