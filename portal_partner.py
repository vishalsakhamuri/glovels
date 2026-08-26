"""The B2B partner's one screen: their students, and where each one has got to.

Vishal: *"we need b2b login like we have for student where B2B counsellors can
upload multiple students profiles and also track their status, shortlist unis
and visa process etc from that login. we will give him white label to add his
company logo as well so that its easy for him."*

And then the four decisions that shaped it: the partner's students do not sign
in, there is no chat, one login per agency, and a partner may see university
names. So this is one screen — a list, a way to add to it, and enough detail
per row that an agency does not have to ring the office to answer "where is
this one".

That last point is the design constraint. He said a partner contacts Glovels
directly rather than through the portal, which is right for questions and
wrong as an excuse for a thin screen: an agency with twenty students that
cannot see their status will ring about all twenty.
"""

BODY = """
    <style>
      /* The shared portal sheet puts a 1180px floor under every table, which
         is right for the Organisation screen's eight columns and wrong here:
         this table has five, sits beside a 320px panel, and was pushing its
         two most useful columns — Documents and Where it is — off the right
         edge behind a "scroll sideways" notice. The floor is what these
         columns actually need. */
      .p-card > .tbl.ptbl{min-width:720px}
      .pcols{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;
        align-items:start}
      /* Below this the panel stops being a column and becomes the next thing
         down the page, which is the only honest way to fit both. */
      @media (max-width:1180px){ .pcols{grid-template-columns:minmax(0,1fr)} }
    </style>

    <div class="out tiles" style="--tiles:3;margin:0 0 20px">
      <div><b id="kStudents">—</b><span>Students you sent</span></div>
      <div><b id="kAssigned">—</b><span>With a counsellor</span></div>
      <div><b id="kShort">—</b><span>Shortlisted</span></div>
    </div>

    <div class="pcols">

      <div class="p-sec" style="min-width:0">
        <div class="p-sec-head"><h2>Your students</h2>
          <input id="findStu" placeholder="Name, email or university"
            style="margin-left:auto;padding:8px 11px;font:400 12.8px/1.4 var(--sans);
            border:1.5px solid #d8dde4;border-radius:9px;min-width:230px"></div>
        <div class="p-card scrollwrap" style="padding:0;overflow-x:auto">
          <table class="tbl ptbl" style="margin:0">
            <thead><tr><th>Student</th><th>Looking at</th><th>Shortlist</th>
              <th>Documents</th><th>Where it is</th></tr></thead>
            <tbody id="stuRows"></tbody>
          </table>
          <div id="stuPager"></div>
        </div>
        <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
          A student is handed to a Glovels counsellor by our office, not from here.
          Until that happens the row says <b>waiting for us</b> — and that is on us,
          not on you. Anything you need beyond this screen, ask your Glovels contact.
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
              <input id="aCountry" placeholder="Germany" style="cursor:text"></div>
            <div class="field" style="margin-bottom:12px">
              <label for="aLevel">Level</label>
              <input id="aLevel" placeholder="Master's" style="cursor:text"></div>
            <button type="button" class="btn btn-primary" id="addOne"
              style="width:100%">Add this student</button>

            <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
              <b style="display:block;font:700 12.4px/1 var(--sans);margin-bottom:7px">
                Or paste a sheet</b>
              <p style="margin:0 0 8px;font-size:11.8px;color:var(--muted);line-height:1.6">
                Copy the rows out of Excel and paste them here. One student a line:
                <b>name, email, mobile, country, level</b>. Up to 200 at a time.</p>
              <textarea id="bulk" rows="5" placeholder="Priya Sharma, priya@example.com, 9876543210, Germany, Master's
Rahul Verma, rahul@example.com, 9876543211, Poland, Master's"
                style="width:100%;padding:10px 11px;font:400 12.4px/1.5 var(--mono,monospace);
                border:1.5px solid #d8dde4;border-radius:10px;resize:vertical"></textarea>
              <button type="button" class="btn btn-ghost" id="addMany"
                style="width:100%;margin-top:9px">Add them all</button>
            </div>
            <div id="addOut" style="margin-top:12px"></div>
          </div>
        </div>

        <div class="p-sec" style="margin:0">
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
"""

SCRIPT = r"""
/* The five stages an application passes through, in the office's own words.
   The partner sees the same names their student would, so a conversation
   between the two of them is about the same thing. */
const STAGE_NAME = ['Not started', 'Documents collected', 'Application drafted',
  'Submitted', 'Under review', 'Decision'];

let ME = null, STUDENTS = [], filter = '';

function stageChip(s) {
  if (!s.counsellor) return '<span class="st wait">waiting for us</span>';
  if (!s.shortlist.length) return '<span class="st wait">shortlist being built</span>';
  if (!s.furthest) return '<span class="st none">shortlist agreed</span>';
  const n = Math.min(s.furthest, 5);
  return '<span class="st ' + (n >= 5 ? 'ok' : 'wait') + '">'
    + esc(STAGE_NAME[n]) + '</span>';
}

function row(s) {
  const want = [s.level, s.field, s.destination].filter(Boolean).join(' · ');
  /* The universities, by name. This is the one gate deliberately open to a
     partner: an agency that cannot tell its own student which universities
     are on their shortlist has nothing to sell. */
  const unis = s.shortlist.length
    ? s.shortlist.slice(0, 3).map(u =>
        '<span class="sl-chip">' + esc(u.university) + '</span>').join(' ')
      + (s.shortlist.length > 3
          ? '<span style="display:block;margin-top:4px;font-size:11.4px;color:var(--muted)">and '
            + (s.shortlist.length - 3) + ' more</span>'
          : '')
    : '<span style="color:var(--muted);font-size:12.4px">—</span>';

  return '<tr>'
    + '<td><b>' + esc(s.name) + '</b>'
      + '<span style="display:block;font-size:11.6px;color:var(--muted)">'
      + esc(s.email) + (s.phone ? ' · ' + esc(s.phone) : '') + '</span></td>'
    + '<td style="font-size:12.4px">'
      + (want ? esc(want) : '<span style="color:var(--muted)">not said yet</span>')
      + (s.package ? '<span style="display:block;margin-top:3px" class="sl-chip">'
          + esc(s.package) + '</span>' : '') + '</td>'
    + '<td style="max-width:260px">' + unis + '</td>'
    + '<td style="font-size:12.4px;white-space:nowrap">'
      + s.docsVerified + '/' + s.docsTotal
      + (s.docsWaiting ? ' <span class="st wait" style="margin-left:4px">'
          + s.docsWaiting + ' waiting</span>' : '') + '</td>'
    + '<td>' + stageChip(s)
      + (s.counsellor
          ? '<span style="display:block;margin-top:4px;font-size:11.4px;color:var(--muted)">'
            + 'with ' + esc(s.counsellor) + '</span>'
          : '') + '</td>'
    + '</tr>';
}

function paint() {
  const q = filter.trim().toLowerCase();
  const list = STUDENTS.filter(s => !q
    || (s.name + ' ' + s.email + ' ' + s.shortlist.map(u => u.university).join(' '))
      .toLowerCase().includes(q));

  $('#kStudents').textContent = STUDENTS.length;
  $('#kAssigned').textContent = STUDENTS.filter(s => s.counsellor).length;
  $('#kShort').textContent = STUDENTS.filter(s => s.shortlist.length).length;

  $('#stuPager').innerHTML = pagerHtml('pstu', list.length, 'students', paint);
  $('#stuRows').innerHTML = paged('pstu', list).map(row).join('')
    || '<tr><td colspan="5" style="padding:22px;color:var(--muted)">'
       + (STUDENTS.length ? 'Nothing matches that.'
          : 'No students yet. Add one on the right, or paste a sheet.')
       + '</td></tr>';
}

/* ------------------------------------------------------------------- adding */

function said(html) { $('#addOut').innerHTML = html; }

/* What came back, in words. A bulk add that says "12 added" and nothing about
   the three it refused is how an agency finds out weeks later that three of
   their students were never on the books. */
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
    if (r.added.length) {
      STUDENTS = (await api('GET', '/api/partner/students')).students;
      paint();
    }
  } catch (e) {
    said('<div class="warnbox" style="border-color:#c0392b;background:#fdf3f2;'
      + 'color:#7a2118">' + esc(e.message) + '</div>');
  }
  btn.disabled = false; btn.textContent = was;
}

/* A pasted sheet. Commas or tabs — Excel gives tabs, a person typing gives
   commas, and refusing one of them because of the other is the kind of thing
   that makes somebody give up and email the file instead. */
function parseSheet(text) {
  return String(text || '').split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !/^name\s*[,\t]/i.test(l))     /* a pasted header row */
    .map(l => {
      const c = l.split(/\t|,/).map(x => x.trim());
      return { name: c[0], email: c[1], phone: c[2], destination: c[3], level: c[4] };
    });
}

/* ---------------------------------------------------------------- the logo */

function showLogo(url) {
  const img = $('#ownLogo');
  const box = $('#logoNow');
  if (url) {
    img.src = url; img.hidden = false;
    img.style.cssText = 'max-width:118px;max-height:46px;display:block;margin-top:9px';
    /* Ours steps aside rather than sitting above theirs. */
    const mark = document.querySelector('.p-logo .logo-img');
    if (mark) mark.style.display = 'none';
    box.innerHTML = '<img src="' + esc(url) + '" alt="Your logo" '
      + 'style="max-width:160px;max-height:60px;border-radius:8px;background:#fff;padding:6px">';
  } else {
    img.hidden = true; img.removeAttribute('src');
    const mark = document.querySelector('.p-logo .logo-img');
    if (mark) mark.style.display = '';
    box.innerHTML = '<span style="font-size:12.4px;color:var(--muted)">None yet.</span>';
  }
}

async function saveLogo(url) {
  try {
    await api('PUT', '/api/partner/logo', { logo: url });
    showLogo(url);
    toast(url ? 'Logo saved.' : 'Logo removed.');
  } catch (e) { toast(e.message); }
}

/* ------------------------------------------------------------------- boot */
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
  $('#staffName').textContent = ME.name;
  $('#staffRole').textContent = 'Partner agency';
  $('#staffAv').textContent = (ME.name || '?').trim().charAt(0).toUpperCase();
  showLogo(ME.logo || '');

  STUDENTS = (await api('GET', '/api/partner/students')).students;
  paint();

  $('#findStu').addEventListener('input', e => {
    filter = e.target.value;
    PAGE_AT.pstu = 0;
    paint();
  });

  $('#addOne').onclick = () => {
    const one = {
      name: $('#aName').value, email: $('#aEmail').value, phone: $('#aPhone').value,
      destination: $('#aCountry').value, level: $('#aLevel').value,
    };
    addStudents([one], $('#addOne')).then(() => {
      ['#aName', '#aEmail', '#aPhone', '#aCountry', '#aLevel']
        .forEach(id => { $(id).value = ''; });
    });
  };

  $('#addMany').onclick = () => {
    const list = parseSheet($('#bulk').value);
    if (!list.length) return said('<div class="warnbox">Paste some rows first.</div>');
    addStudents(list, $('#addMany')).then(() => { $('#bulk').value = ''; });
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
