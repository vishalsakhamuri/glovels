#!/usr/bin/env python3
"""
Visa & enrollment — the documents, not a slideshow of them.

The screen shipped as eight bullet points under a banner that said "Demo
screen. Nothing here reaches a server yet", and a note promising the counsellor
would tick each step. Nothing ticked anything: there was no step to tick, no
row to store it in, and no control anywhere in the operations site. A student
opened it after paying and read a list of nouns.

"Visa documentation to upload screen is better and counsellor can check these
docs." Which is right, and it is also the shape the application already has —
Documents is exactly this: a card per item, a real upload written to the
student's own folder on the server, and a counsellor who verifies each one from
their own screen. The visa stage needed the same thing with a different list,
not a second mechanism.

So the eight bullets become eight documents. Progress is the count of verified
ones, which cannot be wrong, because nothing derives it from a flag somebody
forgot to set. The consulate caveat stays — it is the most honest sentence on
the page — and so does the destination table, which is the only part a student
reads before they have an offer.

This file is also why visa.html stopped being its own donor. build_portal.py
lifted the body out of the page it had just written, which meant every build
re-wrapped the previous build's output; two blank lines a build for as long as
anybody kept building, and a patch applied twice if a marker moved. The body
lives here now, like every other portal screen.
"""

from portal_fields import VISA_JS

BODY = r"""
    <div style="background:#fdf6e6;border:1px solid #e6d5a8;color:#5b4409;border-radius:12px;
      padding:13px 15px;font-size:12.8px;line-height:1.55;margin-bottom:20px;display:flex;gap:9px">
      <svg class="ico" aria-hidden="true"><use href="#i-info"/></svg><span>A visa is granted by the consulate, not by Glovels. We prepare
      the file, book the appointment and run the mock interview. The decision is theirs, and no
      honest consultant will tell you otherwise.</span>
    </div>

    <div class="p-cols" style="margin-bottom:22px">
      <div class="p-card" style="display:flex;gap:18px;align-items:center">
        <svg viewBox="0 0 100 100" style="width:96px;height:96px;flex:none">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#e6eaef" stroke-width="9"/>
          <circle id="vRingFg" cx="50" cy="50" r="42" fill="none" stroke="var(--emerald-deep)"
            stroke-width="9" stroke-linecap="round" transform="rotate(-90 50 50)"/>
          <text id="vRingTxt" x="50" y="56" text-anchor="middle"
            style="font:700 20px/1 var(--sans);fill:var(--navy-900)">0%</text>
        </svg>
        <div>
          <h3 id="vRingHead" style="margin:0 0 5px;font-size:16px">Nothing uploaded yet</h3>
          <p style="margin:0;font-size:12.8px;color:var(--muted);line-height:1.6">
            Your counsellor checks each file and marks it verified. Anything still showing
            <b>In review</b> is with them, not with you.</p>
        </div>
      </div>
      <div class="p-card">
        <h3 style="margin:0 0 9px;font-size:15px">What is still holding things up</h3>
        <ul class="doclist" id="vBlockList" style="margin:0"></ul>
      </div>
    </div>

    <div class="sl-grid" id="visaGrid" style="margin-bottom:26px"></div>

    <h2 style="font-size:18px;margin:0 0 12px">By destination</h2>
    <table class="tbl"><thead><tr><th>Country</th><th>Work rights</th><th>Intakes</th>
      <th>Tests</th></tr></thead><tbody><tr><td><b>🇩🇪 Germany</b></td><td>20 hrs/week during term</td><td style="font-size:12.4px">Winter: 15 Jul . Summer: 15 Jan</td><td style="font-size:12.4px;color:var(--muted)">IELTS 6.5 overall, no band below 6.0 (or TOEFL iBT 88) · German A1-A2 expected for daily life · GRE only for a few TU programmes</td></tr><tr><td><b>🇨🇦 Canada</b></td><td>20 hrs/week during term</td><td style="font-size:12.4px">Sep, Jan and May intakes</td><td style="font-size:12.4px;color:var(--muted)">IELTS 6.5 overall, no band below 6.0</td></tr><tr><td><b>🇬🇧 United Kingdom</b></td><td>20 hrs/week during term</td><td style="font-size:12.4px">Sep and Jan intakes</td><td style="font-size:12.4px;color:var(--muted)">IELTS UKVI 6.5, no band below 6.0</td></tr><tr><td><b>🇮🇪 Ireland</b></td><td>20 hrs/week during term</td><td style="font-size:12.4px">Sep intake, rolling</td><td style="font-size:12.4px;color:var(--muted)">IELTS 6.5 overall</td></tr><tr><td><b>🇵🇱 Poland</b></td><td>Full-time permitted for students</td><td style="font-size:12.4px">Oct and Feb intakes</td><td style="font-size:12.4px;color:var(--muted)">IELTS 6.0, or a medium-of-instruction letter</td></tr><tr><td><b>🇪🇸 Spain</b></td><td>30 hrs/week permitted</td><td style="font-size:12.4px">Sep and Feb intakes</td><td style="font-size:12.4px;color:var(--muted)">IELTS 6.0</td></tr><tr><td><b>🇮🇹 Italy</b></td><td>20 hrs/week during term</td><td style="font-size:12.4px">Sep intake, Universitaly deadlines apply</td><td style="font-size:12.4px;color:var(--muted)">IELTS 6.0</td></tr></tbody></table>
"""

SCRIPT = r"""
/* The visa file, as documents.
 *
 * Same store, same endpoints and same lifecycle as the Documents screen —
 * none → in review → verified — because a second mechanism for the same thing
 * is a second thing to get wrong. The keys are prefixed so the two screens
 * cannot collide, and so Documents can tell a visa file from a loose one
 * somebody sent in the chat.
 *
 * Each card says what it BLOCKS. A student who knows the blocked account holds
 * up the appointment chases the bank; a student reading a list of nouns waits.
 */
""" + VISA_JS + r"""
DB.docs = DB.docs || {};
const VS = {NONE:'none', REVIEW:'wait', OK:'ok'};
const VLABEL = {none:'Not uploaded', wait:'In review', ok:'Verified'};
const vStOf = id => (DB.docs[id] && DB.docs[id].status) || VS.NONE;

function vCard(d) {
  const rec = DB.docs[d.id];
  const st = vStOf(d.id);
  return '<div class="sl" data-vid="' + d.id + '" style="gap:0">' +
    '<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">' +
      '<span style="color:var(--blue-deep);display:flex">' + ico('file') + '</span>' +
      '<h3 style="margin:0;flex:1">' + esc(d.name) + '</h3>' +
      '<span class="st ' + st + '" style="font:700 9.6px/1 var(--sans);letter-spacing:.08em;' +
      'text-transform:uppercase;padding:4px 7px;border-radius:var(--r-pill);white-space:nowrap">' +
      VLABEL[st] + '</span>' +
    '</div>' +
    '<div class="city">Blocks: ' + esc(d.blocks) + '</div>' +
    (rec ? '<div class="sl-meta" style="margin-top:10px">' + ico('check') +
      ' <a href="/api/documents/' + encodeURIComponent(d.id) + '/file" style="color:var(--blue-deep);' +
      'font-weight:600">' + esc(rec.file) + '</a> · ' + rec.size + '</div>' : '') +
    '<div class="drop" data-vdrop="' + d.id + '" style="margin-top:12px;border:1.5px dashed ' +
      (st === VS.NONE ? '#cfd6de' : '#bfe0cc') + ';border-radius:12px;padding:14px;text-align:center;' +
      'cursor:pointer;font:600 12.2px/1.4 var(--sans);color:var(--muted);transition:.16s">' +
      (st === VS.NONE ? 'Drop a file here, or click to choose' : 'Replace this file') +
    '</div>' +
    (rec ? '<button type="button" class="btn btn-ghost btn-sm" data-vrm="' + d.id +
      '" style="margin-top:9px">Remove</button>' : '') +
    (d.need ? '' : '<span class="sl-chip" style="width:fit-content">Only if asked</span>') +
    '</div>';
}

function vPaint() {
  $('#visaGrid').innerHTML = VISA_DOCS.map(vCard).join('');
  const req = VISA_DOCS.filter(d => d.need);
  const ok = req.filter(d => vStOf(d.id) === VS.OK).length;
  const up = req.filter(d => vStOf(d.id) !== VS.NONE).length;
  const pct = Math.round(ok / req.length * 100);
  const C = 2 * Math.PI * 42;
  $('#vRingFg').setAttribute('stroke-dasharray', C);
  $('#vRingFg').setAttribute('stroke-dashoffset', C * (1 - pct / 100));
  $('#vRingTxt').textContent = pct + '%';
  $('#vRingHead').textContent = pct === 100
    ? 'Your visa file is complete'
    : up === 0 ? 'Nothing uploaded yet'
    : ok + ' of ' + req.length + ' verified · ' + (up - ok) + ' waiting on your counsellor';

  /* What is outstanding, in the student's terms. Only the ones that are not
     verified — a list that includes the finished items is a list nobody reads
     twice. */
  $('#vBlockList').innerHTML = VISA_DOCS.filter(d => vStOf(d.id) !== VS.OK).map(d =>
    '<li>' + ico('clock') + ' <span>' + esc(d.blocks) + '</span>' +
    '<span class="st ' + vStOf(d.id) + '">' + esc(d.name) + '</span></li>').join('')
    || '<li>' + ico('check') + ' <span>Nothing is outstanding. Your visa file is with '
       + 'your counsellor.</span></li>';
}

async function vAccept(id, file) {
  if (file.size > 20 * 1024 * 1024) {
    toast('That file is over 20 MB. Please compress it or send a smaller scan.');
    return;
  }
  if (!ONLINE) { toast('Cannot upload while the server is not running.'); return; }
  const fd = new FormData();
  fd.append('key', id);
  fd.append('file', file, file.name);
  const dz = $('[data-vid="' + id + '"] .drop');
  if (dz) dz.textContent = 'Uploading ' + file.name + '…';
  try {
    const r = await api('POST', '/api/documents', fd, true);
    DB.docs = r.docs;
    vPaint();
    toast(file.name + ' uploaded — your counsellor checks it next.');
  } catch (e) {
    vPaint();
    toast('That upload did not go through: ' + e.message);
  }
}

/* One hidden input, reused — a file input per card is eight inputs to keep in
   step with the grid every time it re-renders. */
const vPicker = document.createElement('input');
vPicker.type = 'file';
vPicker.style.display = 'none';
vPicker.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
document.body.appendChild(vPicker);
let vPickFor = null;
vPicker.addEventListener('change', () => {
  if (vPickFor && vPicker.files[0]) vAccept(vPickFor, vPicker.files[0]);
  vPicker.value = '';
});

$('#visaGrid').addEventListener('click', e => {
  const rm = e.target.closest('[data-vrm]');
  if (rm) {
    const key = rm.dataset.vrm;
    delete DB.docs[key];
    vPaint();
    api('DELETE', '/api/documents/' + encodeURIComponent(key))
      .then(r => { DB.docs = r.docs; vPaint(); toast('Removed.'); })
      .catch(() => toast('Could not remove that file.'));
    return;
  }
  const dz = e.target.closest('[data-vdrop]');
  if (dz) { vPickFor = dz.dataset.vdrop; vPicker.click(); }
});
['dragenter','dragover'].forEach(ev =>
  $('#visaGrid').addEventListener(ev, e => {
    const dz = e.target.closest('[data-vdrop]');
    if (!dz) return;
    e.preventDefault();
    dz.style.borderColor = 'var(--blue)';
    dz.style.background = '#f2f6fd';
  }));
['dragleave','drop'].forEach(ev =>
  $('#visaGrid').addEventListener(ev, e => {
    const dz = e.target.closest('[data-vdrop]');
    if (!dz) return;
    e.preventDefault();
    dz.style.borderColor = '';
    dz.style.background = '';
    if (ev === 'drop' && e.dataTransfer.files[0]) vAccept(dz.dataset.vdrop, e.dataTransfer.files[0]);
  }));

vPaint();
"""
