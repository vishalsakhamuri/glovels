"""The counsellor's workspace — their caseload, and the live conversation."""

BODY = """
    <div class="p-cols" style="grid-template-columns:320px 1fr;align-items:start;gap:16px">

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
      (m.file ? '<div style="display:flex;align-items:center;gap:7px;font-weight:600;color:var(--blue-deep)">' +
        ico('file') + esc(m.file) + '</div>' : '') + esc(m.t || '') + '</div>' +
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

function paintRecord(r) {
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
      '<div class="out" style="grid-template-columns:repeat(4,1fr);margin:0 0 16px">' +
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
        '<div id="thread" style="height:min(400px,46vh);overflow-y:auto;display:flex;' +
          'flex-direction:column;gap:12px;padding:4px 2px 12px"></div>' +
        '<div id="typing" style="font:400 11.6px/1.6 var(--sans);color:var(--muted);height:18px"></div>' +
        '<form id="reply" style="display:flex;gap:9px;align-items:flex-end;border-top:1px solid var(--line);' +
          'padding-top:12px">' +
          '<textarea id="rbox" rows="1" placeholder="Reply to ' + esc(r.student.name.split(" ")[0]) + '…" style="flex:1;' +
            'resize:none;max-height:130px;padding:11px 12px;font:400 13.4px/1.5 var(--sans);' +
            'color:var(--navy-900);border:1.5px solid #d8dde4;border-radius:12px"></textarea>' +
          '<button type="submit" class="btn btn-primary btn-sm">Send</button>' +
        '</form>' +
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
        '<h3 style="font-size:14.5px;margin:18px 0 10px">Shortlist</h3>' +
        (r.shortlist.length
          ? '<ul class="doclist">' + r.shortlist.map(p =>
              '<li><span style="flex:1">' + esc(p.program) + ' · <b>' + esc(p.university) + '</b></span>' +
              '<span class="st none" style="text-transform:none;letter-spacing:0">' + money(p) + '</span></li>').join('') + '</ul>'
          : '<p style="font-size:12.8px;color:var(--muted)">Nothing shortlisted yet.</p>') +
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
function ping() {
  const now = Date.now();
  if (now - lastPing < 1500 || !openId) return;
  lastPing = now;
  api('POST', '/api/staff/student/' + openId + '/typing').catch(() => {});
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
