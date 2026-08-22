"""The admin screen — the organisation, and who is looking after whom."""

BODY = """
    <div class="out" style="grid-template-columns:repeat(5,1fr);margin:0 0 20px">
      <div><b id="kStudents">—</b><span>Students</span></div>
      <div><b id="kUnassigned">—</b><span>Unassigned</span></div>
      <div><b id="kDocs">—</b><span>Docs to review</span></div>
      <div><b id="kEnq">—</b><span>Enquiries</span></div>
      <div><b id="kRev">—</b><span>Recorded</span></div>
    </div>

    <div class="p-cols" style="margin-bottom:20px;align-items:start">
      <div class="p-card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:2px">
          <h3 style="margin:0">The team</h3>
          <span style="flex:1"></span>
          <button type="button" class="btn btn-primary btn-sm" id="addPerson">+ Add someone</button>
        </div>
        <ul class="doclist" id="counsellors" style="margin-top:12px"></ul>
        <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">A counsellor
          can open a student's profile, documents and conversation only once that student is
          assigned to them. The rule is enforced on the server, not by hiding a row.</p>
      </div>
      <div class="p-card">
        <h3>Channels</h3>
        <ul class="doclist" id="channels"></ul>
        <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">Email falls
          back to writing <code>.eml</code> files into <code>data/outbox/</code> until
          <code>mail.env</code> has a password in it. WhatsApp needs a Meta Business account and a
          public HTTPS webhook — the messenger works without it.</p>
      </div>
    </div>

    <div class="modal" id="personModal" role="dialog" aria-modal="true">
      <div class="sheet" style="width:min(520px,100%)">
        <button class="sheet-close" data-close aria-label="Close">✕</button>
        <h3 id="pTitle">Add someone to the team</h3>
        <p class="lead">They can sign in straight away with the password this creates.</p>
        <div id="pForm">
          <div class="field" style="margin-bottom:10px"><label for="pName">Their name</label>
            <input id="pName" placeholder="Kavya Reddy"></div>
          <div class="field" style="margin-bottom:10px"><label for="pEmail">Work email</label>
            <input id="pEmail" placeholder="kavya@glovels.com" inputmode="email"></div>
          <div class="field" style="margin-bottom:10px"><label for="pPhone">Mobile (optional)</label>
            <input id="pPhone" inputmode="tel" placeholder="98765 43210"></div>
          <div class="field" style="margin-bottom:10px"><label for="pRole">What kind of account</label>
            <select id="pRole">
              <option value="counsellor">Counsellor — their own students, and the chat</option>
              <option value="editor">Website editor — the site only, no student records</option>
              <option value="admin">Administrator — everything, including this screen</option>
              <option value="student">Student — a real student account, assigned to you</option>
            </select></div>
          <p id="pStudentNote" style="display:none;margin:0 0 10px;padding:11px 13px;
            border-radius:10px;background:#f1f6fb;border:1px solid #cfe0f2;
            font:600 12.4px/1.55 var(--sans);color:var(--navy-800)">
            A real student account &mdash; their own dashboard, shortlist, documents and
            messages &mdash; assigned to you. Give them the password below and they can change
            it themselves. Use this for a walk-in, or to make yourself a test login.</p>
          <div id="pPermBox" style="padding:12px 14px;border-radius:11px;background:var(--paper);
            border:1px solid var(--line,#e6e9ee);margin-bottom:4px">
            <span style="display:block;font:800 10.4px/1 var(--sans);letter-spacing:.12em;
              text-transform:uppercase;color:var(--muted);margin-bottom:9px">What they may change
              on the website</span>
            <label style="display:flex;gap:8px;align-items:flex-start;font:600 12.8px/1.45
              var(--sans);color:var(--navy-800);margin-bottom:8px">
              <input type="checkbox" id="pPermContent" style="margin-top:2px">
              <span>The home page &mdash; packages, prices, the figures, the questions, the
                stories and the wording</span></label>
            <label style="display:flex;gap:8px;align-items:flex-start;font:600 12.8px/1.45
              var(--sans);color:var(--navy-800)">
              <input type="checkbox" id="pPermCatalogue" style="margin-top:2px">
              <span>Universities and destinations &mdash; adding, editing and removing what the
                finder offers</span></label>
          </div>
          <p style="margin:8px 0 0;font-size:11.8px;color:var(--muted);line-height:1.55">
            A password is generated and shown once, on the next screen. It is stored hashed, so
            nobody &mdash; including you &mdash; can read it back afterwards. If it is lost, use
            <b>Reset password</b> beside their name.</p>
        </div>
        <div id="pDone" style="display:none"></div>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap" id="pButtons">
          <button type="button" class="btn btn-primary" id="pSave">Create the account</button>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        </div>
        <p id="pErr" role="alert" style="display:none;margin:14px 0 0;padding:11px 13px;
          border-radius:10px;font:600 12.8px/1.5 var(--sans);background:#fdf3f2;
          border:1px solid #f0c8c4;color:#7a2118"></p>
      </div>
    </div>

    <div class="p-sec">
      <div class="p-sec-head"><h2>Every student</h2>
        <input id="findStudent" placeholder="Search" style="margin-left:auto;padding:8px 11px;
          font:400 12.8px/1.4 var(--sans);border:1.5px solid #d8dde4;border-radius:9px;min-width:220px"></div>
      <div class="p-card" style="padding:0;overflow-x:auto">
        <table class="tbl" style="margin:0">
          <thead><tr><th>Student</th><th>Package</th><th>Shortlist</th><th>Documents</th>
            <th>Counsellor</th><th></th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
"""

SCRIPT = r"""
let STUDENTS = [], COUNSELLORS = [], PEOPLE = [], ME = 0, filter = '';

/* The two things an account can be trusted with beyond its own students. */
const PERMS = [['content', 'Home page'], ['catalogue', 'Universities']];

const inr = p => '₹' + Number(p / 100).toLocaleString('en-IN');

function row(s) {
  const opts = ['<option value="">— unassigned —</option>'].concat(
    COUNSELLORS.map(c => '<option value="' + c.id + '"' +
      (s.counsellor && s.counsellor.id === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>')
  ).join('');
  return '<tr data-row="' + s.id + '">' +
    '<td><b>' + esc(s.name) + '</b><br><span style="font-size:11.8px;color:var(--muted)">' +
      esc(s.email) + '</span></td>' +
    '<td>' + (s.package ? '<span class="sl-chip">' + esc(s.package) + '</span>'
                        : '<span style="color:var(--muted);font-size:12.4px">—</span>') + '</td>' +
    '<td>' + s.shortlist + '</td>' +
    '<td>' + s.docsVerified + '/' + s.docsTotal +
      (s.docsWaiting ? ' <span class="st wait" style="margin-left:5px">' + s.docsWaiting + ' waiting</span>' : '') + '</td>' +
    '<td><select data-assign="' + s.id + '" style="padding:7px 9px;font:600 12.4px/1.3 var(--sans);' +
      'border:1.5px solid ' + (s.counsellor ? '#d8dde4' : '#e0b4ae') + ';border-radius:8px;' +
      'background:' + (s.counsellor ? 'var(--paper)' : '#fdf3f2') + '">' + opts + '</select></td>' +
    '<td><a class="btn btn-ghost btn-sm" href="counsellor.html?student=' + s.id + '">Open' +
      (s.unread ? ' <span class="st wait" style="margin-left:5px">' + s.unread + '</span>' : '') + '</a></td>' +
    '</tr>';
}

function paint() {
  const q = filter.toLowerCase();
  const list = STUDENTS.filter(s => !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  $('#rows').innerHTML = list.map(row).join('') ||
    '<tr><td colspan="6" style="color:var(--muted);padding:22px">Nobody matches that search.</td></tr>';
}

staffBoot(async me => {
  if (me.user.role !== 'admin') {
    document.querySelector('.p-main').innerHTML =
      '<div class="sl-empty" style="margin-top:40px"><b>This screen is for admins</b>' +
      '<p>You are signed in as a counsellor. Your students and conversations are on the ' +
      'Conversations screen.</p><a class="btn btn-primary" href="counsellor.html">Open Conversations</a></div>';
    return;
  }

  const [ov, st] = await Promise.all([
    api('GET', '/api/staff/overview'),
    api('GET', '/api/staff/students'),
  ]);

  STUDENTS = st.students;
  COUNSELLORS = ov.counsellors;

  $('#kStudents').textContent = ov.students;
  $('#kUnassigned').textContent = ov.unassigned;
  $('#kDocs').textContent = ov.docsWaiting;
  $('#kEnq').textContent = ov.enquiries;
  $('#kRev').textContent = inr(ov.revenuePaise);

  /* "Recorded", not "revenue" — no payment gateway is connected yet, so this is
     the total of orders placed, not money received. Calling it revenue on an
     admin screen is how a number ends up in a board pack. */
  $('#kRev').parentElement.querySelector('span').textContent = 'Orders placed';

  ME = me.user.id;
  await paintPeople();

  $('#channels').innerHTML =
    '<li>' + ico('mail') + '<span style="flex:1">Email</span><span class="st ' +
      (ov.channels.mail === 'smtp' ? 'ok' : 'wait') + '">' +
      (ov.channels.mail === 'smtp' ? 'Sending' : 'Outbox only') + '</span></li>' +
    '<li>' + ico('chat') + '<span style="flex:1">WhatsApp</span><span class="st ' +
      (/^configured/.test(ov.channels.whatsapp) ? 'ok' : 'none') + '">' +
      (/^configured/.test(ov.channels.whatsapp) ? 'Configured' : 'Off') + '</span></li>' +
    '<li>' + ico('check') + '<span style="flex:1">Live messenger</span>' +
      '<span class="st ok">' + (ov.online.students + ov.online.staff) + ' online</span></li>';

  paint();
});

document.addEventListener('change', async e => {
  const sel = e.target.closest('[data-assign]');
  if (!sel) return;
  const id = Number(sel.dataset.assign);
  const cid = sel.value === '' ? null : Number(sel.value);
  try {
    await api('PUT', '/api/staff/student/' + id + '/counsellor', { counsellorId: cid });
    const s = STUDENTS.find(x => x.id === id);
    const c = COUNSELLORS.find(x => x.id === cid);
    if (s) s.counsellor = c ? { id: c.id, name: c.name } : null;
    toast(c ? 'Assigned to ' + c.name + ' — they can open the file now.'
            : 'Unassigned. Nobody but an admin can open that file now.');
    paint();
  } catch (err) {
    toast(err.message);
  }
});

$('#findStudent').addEventListener('input', e => { filter = e.target.value; paint(); });

/* ------------------------------------------------------------------ the team */
/*
 * On a laptop the three demo accounts are created by the seeder and this screen
 * only ever had to list them. On a public address there are no demo accounts,
 * so an organisation starts as one administrator with nobody to answer the
 * chat — and until this existed there was no way inside the application to
 * change that.
 */

async function paintPeople() {
  const r = await api('GET', '/api/staff/people');
  PEOPLE = r.people;
  COUNSELLORS = PEOPLE.filter(p => p.role === 'counsellor')
    .map(p => ({ id: p.id, name: p.name, caseload: p.caseload }));

  $('#counsellors').innerHTML = PEOPLE.map(p =>
    '<li>' + ico('user') +
    '<span style="flex:1"><b>' + esc(p.name) + '</b>' +
      (p.id === ME ? ' <span class="st none">you</span>' : '') +
      '<br><span style="font-size:11.6px;color:var(--muted)">' + esc(p.email) + '</span></span>' +
    '<span class="st ' + (p.role === 'admin' ? 'ok' : p.caseload ? 'ok' : 'none') + '">' +
      (p.role === 'admin' ? 'Administrator'
        : p.role === 'editor' ? 'Website editor'
        : p.caseload + ' student' + (p.caseload === 1 ? '' : 's')) + '</span>' +
    '</li>' +
    /* The permissions sit under the person rather than beside them: they are
       the answer to "what can this account do to the website", which is a
       different question from "who is this", and squeezing both onto one line
       made neither readable. */
    '<li style="padding-top:0;border-top:0;align-items:center;flex-wrap:wrap;gap:8px">' +
    '<span style="width:26px"></span>' +
    (p.role === 'admin'
      ? '<span class="st ok">Everything &mdash; administrators are not restricted</span>'
      : PERMS.map(function (perm) {
          const on = p.perms.indexOf(perm[0]) >= 0;
          return '<button type="button" class="btn btn-ghost btn-sm" data-perm="' + p.id +
            '" data-key="' + perm[0] + '" data-on="' + (on ? '1' : '0') + '"' +
            ' style="border-color:' + (on ? '#c8e3d0' : '#e0e4ea') +
            ';background:' + (on ? '#f1f8f3' : 'transparent') +
            ';color:' + (on ? '#1d5c33' : 'var(--muted)') + '">' +
            (on ? '\u2713 ' : '') + perm[1] + '</button>';
        }).join('')) +
    '<span style="flex:1"></span>' +
    '<button type="button" class="btn btn-ghost btn-sm" data-pw="' + p.id +
      '">Reset password</button>' +
    (p.id === ME ? '' :
      '<select data-role="' + p.id + '" style="margin-left:6px;padding:6px 9px;' +
      'font:600 12.2px/1.3 var(--sans);border:1.5px solid #d8dde4;border-radius:8px">' +
      [['counsellor', 'Counsellor'], ['editor', 'Website editor'], ['admin', 'Administrator']]
        .map(function (r) {
          return '<option value="' + r[0] + '"' + (p.role === r[0] ? ' selected' : '') + '>' +
            r[1] + '</option>';
        }).join('') + '</select>')
    + '</li>').join('') || '<li><span>Nobody yet</span></li>';

  paint();
}

function showPassword(title, name, email, password) {
  $('#pTitle').textContent = title;
  $('#pForm').style.display = 'none';
  $('#pButtons').style.display = 'none';
  $('#pErr').style.display = 'none';
  const box = $('#pDone');
  box.style.display = '';
  box.innerHTML =
    '<p style="margin:0 0 12px;font:600 13.4px/1.55 var(--sans)">' + esc(name) +
      (email ? ' &mdash; <span style="font-weight:500;color:var(--muted)">' + esc(email) + '</span>' : '') +
    '</p>' +
    '<div style="padding:14px 16px;border-radius:12px;background:var(--paper);' +
      'border:1.5px dashed #c9a227"><span style="display:block;font:800 10.4px/1 var(--sans);' +
      'letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:7px">' +
      'Password</span><code style="font:700 17px/1.3 ui-monospace,monospace;' +
      'word-break:break-all">' + esc(password) + '</code></div>' +
    '<p style="margin:12px 0 0;font:600 12.6px/1.55 var(--sans);color:#7a5510">' +
      'Copy it now and send it to them. It is stored hashed, so this is the only time it ' +
      'can be shown &mdash; close this and it is gone.</p>' +
    '<div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-primary" id="pCopy">Copy the password</button>' +
      '<button type="button" class="btn btn-ghost" data-close>Done</button></div>';
}

function openPersonForm() {
  $('#pTitle').textContent = 'Add someone to the team';
  $('#pForm').style.display = '';
  $('#pButtons').style.display = 'flex';
  $('#pDone').style.display = 'none';
  $('#pErr').style.display = 'none';
  ['pName', 'pEmail', 'pPhone'].forEach(id => { $('#' + id).value = ''; });
  $('#pRole').value = 'counsellor';
  $('#pPermContent').checked = false;
  $('#pPermCatalogue').checked = false;
  syncRole();
  $('#personModal').classList.add('on');
  setTimeout(() => $('#pName').focus(), 50);
}

document.addEventListener('click', async e => {
  if (e.target.closest('#addPerson')) return openPersonForm();
  if (e.target.closest('[data-close]') || e.target === $('#personModal')) {
    $('#personModal').classList.remove('on');
    return;
  }

  if (e.target.closest('#pCopy')) {
    const code = $('#pDone code');
    try {
      await navigator.clipboard.writeText(code.textContent);
      toast('Copied.');
    } catch (err) {
      /* Clipboard access is refused on an insecure origin and in some browsers
         without a gesture it trusts. Selecting it is not as good and is better
         than a button that silently fails. */
      const r = document.createRange();
      r.selectNodeContents(code);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast('Copy it with Cmd-C — this browser would not let the button do it.');
    }
    return;
  }

  if (e.target.closest('#pSave')) {
    const btn = e.target.closest('#pSave');
    const body = {
      name: $('#pName').value, email: $('#pEmail').value,
      phone: $('#pPhone').value, role: $('#pRole').value,
      perms: [$('#pPermContent').checked && 'content',
              $('#pPermCatalogue').checked && 'catalogue'].filter(Boolean),
    };
    $('#pErr').style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      const r = await api('POST', '/api/staff/people', body);
      await paintPeople();
      showPassword('Account created', r.person.name, r.person.email, r.password);
      toast(r.person.name + ' can sign in now.');
    } catch (err) {
      $('#pErr').textContent = err.message;
      $('#pErr').style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create the account';
    }
    return;
  }

  const pw = e.target.closest('[data-pw]');
  if (pw) {
    const p = PEOPLE.find(x => x.id === Number(pw.dataset.pw));
    if (!confirm('Reset the password for ' + p.name + '? They will be signed out everywhere '
      + 'and will need the new password to get back in.')) return;
    try {
      const r = await api('POST', '/api/staff/people/' + p.id + '/password');
      $('#personModal').classList.add('on');
      showPassword('New password', r.name, p.email, r.password);
    } catch (err) { toast(err.message); }
    return;
  }

  const pm = e.target.closest('[data-perm]');
  if (pm) {
    const p = PEOPLE.find(x => x.id === Number(pm.dataset.perm));
    const key = pm.dataset.key;
    const next = pm.dataset.on === '1'
      ? p.perms.filter(x => x !== key)
      : p.perms.concat([key]);
    try {
      await api('PUT', '/api/staff/people/' + p.id + '/perms', { perms: next });
      await paintPeople();
      toast(p.name + (next.indexOf(key) >= 0 ? ' can now change ' : ' can no longer change ') +
        (key === 'content' ? 'the home page.' : 'the universities.'));
    } catch (err) { toast(err.message); }
    return;
  }
});

/* The role picker is a <select>, so it arrives on change and not on click. */
document.addEventListener('change', async e => {
  const rl = e.target.closest('select[data-role]');
  if (!rl) return;
  const p = PEOPLE.find(x => x.id === Number(rl.dataset.role));
  const to = rl.value;
  const what = to === 'admin'
    ? 'an administrator — they will be able to see every student and every file, and add people.'
    : to === 'editor'
      ? 'a website editor — they lose all student records and see only the parts of the site '
        + 'they are allowed to change.'
      : 'a counsellor — they see the students assigned to them, and the chat.';
  if (!confirm(p.name + ' becomes ' + what)) { await paintPeople(); return; }
  try {
    await api('PUT', '/api/staff/people/' + p.id + '/role', { role: to });
    await paintPeople();
    toast(p.name + ' is now a ' + (to === 'editor' ? 'website editor' : to) + '.');
  } catch (err) {
    toast(err.message);
    await paintPeople();
  }
});

/* An administrator has every permission by definition, so offering the boxes
   next to that choice would be offering something that does nothing. */
function syncRole() {
  const role = $('#pRole').value;
  /* An administrator has every permission by definition, and a student has
     none of them — offering the boxes next to either is offering something
     that does nothing. */
  $('#pPermBox').style.display = (role === 'admin' || role === 'student') ? 'none' : '';
  if (role === 'editor' && !$('#pPermContent').checked && !$('#pPermCatalogue').checked) {
    $('#pPermContent').checked = true;
  }
  const note = $('#pStudentNote');
  if (note) note.style.display = role === 'student' ? '' : 'none';
}
$('#pRole').addEventListener('change', syncRole);

addEventListener('keydown', e => {
  if (e.key === 'Escape') $('#personModal').classList.remove('on');
});
"""
