"""My Profile — the 11-section intake with a live completeness meter.

The field list itself lives in `portal_fields.py`, because the partner
portal renders the same form: an agency filling in a student's record on
their behalf must be filling in THE record, not a second one shaped like it.
"""

from portal_fields import SECTIONS_JS

BODY = """
    <div class="p-card" style="margin-bottom:20px">
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:9px">
        <h3 style="margin:0">Profile completeness</h3>
        <span class="pill" id="pcPill" style="margin-left:auto">0% complete</span>
      </div>
      <div class="bar" style="margin-bottom:9px"><span id="pcBar" style="width:0%"></span></div>
      <p style="margin:0;font-size:12.6px;color:var(--muted);line-height:1.55">Your counsellor
        starts the shortlist once this reaches 100%. Everything here is reused across your
        applications, your SOP brief, the LOR emails to your recommenders and the visa checklist —
        so it is asked once, not eleven times.</p>
    </div>

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

    <div class="p-cols aside" style="--aside:230px;align-items:start">
      <nav class="p-card" id="secNav" style="padding:10px;position:sticky;top:18px"></nav>
      <div>
        <form id="pForm" novalidate></form>
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <!-- Back before forward. Eleven sections with only a Next is a form
               you can walk into and not out of without going up to the nav. -->
          <button type="button" class="btn btn-ghost" id="prevBtn">← Previous section</button>
          <button type="button" class="btn btn-primary" id="saveBtn">Save this section</button>
          <button type="button" class="btn btn-ghost" id="nextBtn">Next section →</button>
          <button type="button" class="btn btn-ghost" id="fillBtn"
            style="margin-left:auto">Fill with demo answers</button>
        </div>

        <!-- Findable, not buried, and not shouting either. Apple requires a
             way to delete an account wherever one can be created, and this
             screen is where a student's record lives, so this is where it
             belongs. -->
        <section class="p-card danger" id="dangerZone" style="margin-top:28px">
          <h3>Delete my account</h3>
          <p class="d-say">This cannot be undone. Everything personal to you is
            removed from our servers: your profile, the documents you uploaded,
            your shortlist, your applications, every message with your
            counsellor, and your sign-in.</p>
          <p class="d-say"><b>One thing is kept.</b> If you have paid for a
            package, the record of that payment stays in our accounts — we are
            required to keep an invoice, and removing your name from one would
            not protect you, it would only make a refund impossible to trace.
            Nothing else survives.</p>
          <button type="button" class="btn btn-ghost d-open" id="delOpen">Delete my account</button>

          <div id="delConfirm" hidden>
            <div class="field" style="margin-bottom:14px">
              <label for="delEmail">Type your email address to confirm</label>
              <input type="email" id="delEmail" autocomplete="off" placeholder="you@email.com">
            </div>
            <div class="field" style="margin-bottom:14px">
              <label for="delPass">Your password</label>
              <input type="password" id="delPass" autocomplete="current-password">
            </div>
            <p class="ferr" id="delErr" hidden></p>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button type="button" class="btn d-go" id="delGo">Delete permanently</button>
              <button type="button" class="btn btn-ghost" id="delCancel">Keep my account</button>
            </div>
          </div>
        </section>
      </div>
    </div>
"""

SCRIPT = r"""
/* The 11 sections from the portal spec. Authored as data, not as markup: the
   completeness meter, the section nav and the form all have to agree on what
   the fields are, and three hand-maintained copies of that list is how they
   stop agreeing. */
""" + SECTIONS_JS + r"""
const DEMO = {
  firstName:'Vishal', lastName:'Sakhamuri',
  dob:'2002-04-11', gender:'Male', pob:'Hyderabad',
  phone:'98765 43210', email:'student@glovels.com',
  addr1:'Plot 60, 1st Floor', addr2:'Behind Big C Mobiles, Madhapur',
  city:'Hyderabad', state:'Telangana', pin:'500081', addr_country:'India',
  x_board:'CBSE — Central Board of Secondary Education',
  x_year:'2018', x_score:'88%', x_school:'Delhi Public School',
  xii_board:'CBSE — Central Board of Secondary Education',
  xii_year:'2020', xii_score:'91%', xii_stream:'Science (PCM)',
  d_uni:'JNTU Hyderabad', d_course:'B.Tech Electronics & Communication', d_dur:'4 years',
  d_start:'2020', d_year:'2024', d_cgpa:'7.6', d_max:'10', d_pass:'4', d_backlog:'None',
  e_test:'IELTS', e_score:'7.0', e_date:'2026-03-14', e_low:'6.5',
  e_listen:'7.5', e_read:'7.5', e_write:'6.5', e_speak:'7.0',
  a_test:'Not required', a_score:'', a_date:'',
  w_has:'Yes — internship', w_emp:'Qualcomm India', w_role:'Intern, Embedded Systems', w_months:'6',
  g_level:"Master's", g_field:'Data Science',
  g_field2:'Artificial Intelligence', g_field3:'Computer Science',
  g_country:'Germany', g_intake:'Winter 2026',
  g_why:'I built a fault-detection model for my final-year project and want to take it further where the research and the industry sit close together.',
  b_total:'Under ₹10 Lakhs', b_fund:'A mix', b_loan:'Yes', b_spons:'Parent',
  r1_name:'Prof. S. Raghavan', r1_role:'Head of Department, ECE', r1_mail:'raghavan@jntuh.ac.in',
  r2_name:'Anita Menon', r2_role:'Engineering Manager, Qualcomm', r2_mail:'anita.menon@example.com',
  p_has:'Yes', p_num:'M4471902', p_exp:'2031-08-02', p_refuse:'No'
};

DB.profile = DB.profile || {};

/* A record written before the name was split.
 *
 * It has fullName and neither half, so the two boxes would open empty and the
 * profile would read as less complete than it is — and saving would then
 * compose a name from two blanks. Split once, on the LAST space, because a
 * middle name belongs with the given name far more often than it belongs with
 * the surname. Nothing is written back until they save, so a split we got
 * wrong is one they can correct in the box in front of them. */
(function () {
  const p = DB.profile;
  if ((p.firstName || p.lastName) || !p.fullName) return;
  const bits = String(p.fullName).trim().split(/\s+/);
  p.lastName = bits.length > 1 ? bits.pop() : '';
  p.firstName = bits.join(' ');
})();
let cur = 0;

/* A field that does not apply to you must not hold your profile below 100%.
   "GRE score" is not missing when the answer to "GRE?" is "not required" — it is
   answered. Counting it as missing is how a completeness meter becomes a number
   nobody can ever clear, and then nobody trusts. */
/* A field can be hidden outright — "what happened?" is shown only to somebody
   who said there WAS a refusal. Something not on the screen cannot be missing
   from it, so it is not counted either way. */
const shown = f => !f.show || !!f.show(DB.profile);
const needed = f => shown(f) && !(f.opt && f.opt(DB.profile));
const filled = f => (DB.profile[f.k] || '').toString().trim() !== '';
function pctOf(sec) {
  const req = sec.fields.filter(needed);
  if (!req.length) return 100;
  return Math.round(req.filter(filled).length / req.length * 100);
}
function overall() {
  const req = SECTIONS.flatMap(s => s.fields).filter(needed);
  return Math.round(req.filter(filled).length / req.length * 100);
}

function drawNav() {
  $('#secNav').innerHTML = SECTIONS.map((s, i) => {
    const p = pctOf(s);
    const mark = p === 100 ? ico('check')
      : '<span style="width:15px;height:15px;border-radius:50%;border:2px solid var(--line);display:inline-block"></span>';
    return '<button type="button" data-i="' + i + '" style="' +
      'display:flex;align-items:center;gap:9px;width:100%;text-align:left;cursor:pointer;' +
      'border:0;background:' + (i === cur ? 'var(--cream)' : 'transparent') + ';' +
      'border-radius:10px;padding:9px 10px;font:' + (i === cur ? '700' : '600') +
      ' 12.6px/1.3 var(--sans);color:' + (i === cur ? 'var(--navy-900)' : 'var(--navy-800)') + '">' +
      '<span style="color:' + (p === 100 ? 'var(--green)' : 'var(--muted)') + ';display:grid;place-items:center;width:15px">' +
      mark + '</span>' + esc(s.name.replace('&amp;','&')) +
      '<span style="margin-left:auto;font:800 9.6px/1 var(--sans);color:var(--muted)">' + p + '%</span>' +
      '</button>';
  }).join('');
}

function drawForm() {
  const s = SECTIONS[cur];
  const groups = s.groups || null;

  /* One field. The three input shapes that are not a plain box each exist for
     a reason written beside them. */
  const fieldHtml = f => {
    const v = DB.profile[f.k] || '';
    const req = !!f.must;
    let input;

    if (f.t === 'multi') {
      /* Checkboxes, not a multi-select list box. A <select multiple> needs a
         ctrl-click nobody knows about and is unusable on a phone, which is
         where most of these are filled in. Stored comma-joined, so everything
         that already reads one answer still reads a string. */
      const on = new Set(String(v).split(',').map(x => x.trim()).filter(Boolean));
      input = '<div class="multi" data-multi="' + f.k + '">' + (f.o || []).map(o =>
        '<label class="mchk' + (on.has(o) ? ' on' : '') + '">' +
        '<input type="checkbox" value="' + esc(o) + '"' + (on.has(o) ? ' checked' : '') +
        '>' + esc(o) + '</label>').join('') + '</div>';

    } else if (f.t === 'date3') {
      /* Day, month, year as three lists. See the note on p_exp in
         portal_fields.py: a native date input has segments rather than text,
         so what backspace does to it is the browser's business, and on a
         phone there is no keyboard involved at all. */
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v)) || [];
      const yy = parts[1] || '', mm = parts[2] || '', dd = parts[3] || '';
      const opt = (val, label, sel) => '<option value="' + val + '"' +
        (val === sel ? ' selected' : '') + '>' + label + '</option>';
      const days = ['<option value="">Day</option>'];
      for (let i = 1; i <= 31; i++) {
        const n = String(i).padStart(2, '0');
        days.push(opt(n, String(i), dd));
      }
      const MON = ['January','February','March','April','May','June','July',
        'August','September','October','November','December'];
      const months = ['<option value="">Month</option>'].concat(
        MON.map((m, i) => opt(String(i + 1).padStart(2, '0'), m, mm)));
      const years = ['<option value="">Year</option>'].concat(
        YEARS(f.back == null ? 40 : f.back, f.ahead || 0)
          .filter(Boolean).map(y => opt(y, y, yy)));
      input = '<div class="d3" data-date="' + f.k + '">' +
        '<select data-part="d" aria-label="Day">' + days.join('') + '</select>' +
        '<select data-part="m" aria-label="Month">' + months.join('') + '</select>' +
        '<select data-part="y" aria-label="Year">' + years.join('') + '</select></div>';

    } else if (f.t === 'select') {
      /* `years` builds the list from today, so it is never a year out of date. */
      const opts = f.years ? YEARS(f.years[0], f.years[1]) : (f.o || []);
      input = '<select name="' + f.k + '">' + opts.map(o =>
        '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' +
        (o === '' ? 'Select…' : esc(o)) + '</option>').join('') + '</select>';

    } else if (f.t === 'textarea') {
      input = '<textarea name="' + f.k + '" rows="4" placeholder="' + esc(f.ph || '') + '" style="' +
        'width:100%;padding:12px;font:400 14px/1.6 var(--sans);color:var(--navy-900);' +
        'border:1.5px solid #d8dde4;border-radius:var(--r);resize:vertical">' + esc(v) + '</textarea>';

    } else {
      input = '<input type="' + f.t + '" name="' + f.k + '" value="' + esc(v) +
        '" placeholder="' + esc(f.ph || '') + '"' + (req ? ' required' : '') + '>';
    }

    return '<div class="field' + (req ? ' must' : '') + '" data-k="' + f.k +
      '" style="margin-bottom:15px"><label>' + esc(f.l) +
      (req ? '<span class="reqmark" title="Required">required</span>' : '') +
      (!req && !needed(f) ? '<span style="margin-left:auto;font-weight:700;color:var(--muted);' +
        'text-transform:none;letter-spacing:0">optional</span>' : '') + '</label>' + input +
      '<p class="ferr" hidden></p>' +
      (f.help ? '<p style="margin:6px 0 0;font-size:11.8px;color:var(--muted);line-height:1.5">' +
        esc(f.help) + '</p>' : '') + '</div>';
  };

  const live = s.fields.filter(shown);
  let body;
  if (groups) {
    /* Grouped sections draw one tinted block per group, so a designation and
       an email belong visibly to the person named above them. */
    const seen = [];
    body = live.filter(f => !f.grp).map(fieldHtml).join('');
    live.forEach(f => { if (f.grp && seen.indexOf(f.grp) < 0) seen.push(f.grp); });
    body += seen.map(g => {
      const meta = groups[g] || { name: g, tone: 'blue' };
      return '<div class="fgrp ' + esc(meta.tone || 'blue') + '">' +
        '<b>' + esc(meta.name) + '</b>' +
        (meta.note ? '<span>' + esc(meta.note) + '</span>' : '') +
        live.filter(f => f.grp === g).map(fieldHtml).join('') + '</div>';
    }).join('');
  } else {
    body = live.map(fieldHtml).join('');
  }

  $('#pForm').innerHTML =
    '<div class="p-card"><h3>' + ico(s.icon.replace('i-','')) + ' ' + esc(s.name.replace('&amp;','&')) +
    '<span class="pill">' + pctOf(s) + '% done</span></h3>' + body + '</div>';

  /* Answering "GRE: not required" has to re-score the section on the spot,
     not on the next save — otherwise the meter argues with the form. The date
     and multi controls get a lighter handler: they change no other field's
     relevance, and redrawing the form under somebody's finger loses their
     place in a list of forty years. */
  $$('#pForm select[name]').forEach(el => el.addEventListener('change', () => {
    readForm(); save(); drawForm(); paint();
  }));
  $$('#pForm .d3 select, #pForm .multi input').forEach(el =>
    el.addEventListener('change', () => {
      readForm(); save(); paint();
      const box = el.closest('.multi');
      if (box) box.querySelectorAll('.mchk').forEach(l =>
        l.classList.toggle('on', l.querySelector('input').checked));
    }));
  $$('#pForm textarea').forEach(t => {
    t.addEventListener('focus', () => { t.style.borderColor = 'var(--blue)'; t.style.boxShadow = '0 0 0 4px rgba(26,79,180,.16)'; });
    t.addEventListener('blur',  () => { t.style.borderColor = '#d8dde4'; t.style.boxShadow = 'none'; });
  });
}

function readForm() {
  $$('#pForm [name]').forEach(el => { DB.profile[el.name] = el.value; });
  /* Three lists back into one YYYY-MM-DD, because that is what the server, the
     visa checklist and every screen that prints a date already expect. A part
     missing means no date at all rather than half of one. */
  $$('#pForm [data-date]').forEach(box => {
    const g = s => (box.querySelector('[data-part="' + s + '"]') || {}).value || '';
    const y = g('y'), m = g('m'), d = g('d');
    DB.profile[box.dataset.date] = (y && m && d) ? y + '-' + m + '-' + d : '';
  });
  $$('#pForm [data-multi]').forEach(box => {
    DB.profile[box.dataset.multi] = [...box.querySelectorAll('input:checked')]
      .map(i => i.value).join(', ');
  });
}

/* The two the office cannot work without. Everything else on this form can be
   filled in later; a record with no way to reach the person cannot. */
const MUST = [
  {k:'phone', l:'Mobile number',
   ok:v => /^[6-9]\d{9}$/.test(v.replace(/\D/g, '')),
   why:'Ten digits, starting 6 to 9.'},
  {k:'email', l:'Email',
   ok:v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
   why:'Something like you@email.com.'},
];

/* Returns the first problem, or null. Only checks fields that are ON the
   section being saved — being stopped from saving Class 10 because of a
   mobile number four sections away is a form arguing with itself. */
function firstProblem() {
  const here = SECTIONS[cur].fields.map(f => f.k);
  for (const m of MUST) {
    if (here.indexOf(m.k) < 0) continue;
    const v = String(DB.profile[m.k] || '').trim();
    if (!v) return { k:m.k, say: m.l + ' is required.' };
    if (!m.ok(v)) return { k:m.k, say: m.l + ' does not look right. ' + m.why };
  }
  return null;
}

function showProblem(p) {
  $$('#pForm .ferr').forEach(e => { e.hidden = true; e.textContent = ''; });
  $$('#pForm .field').forEach(e => e.classList.remove('bad'));
  if (!p) return;
  const box = $('#pForm .field[data-k="' + p.k + '"]');
  if (box) {
    box.classList.add('bad');
    const e = box.querySelector('.ferr');
    if (e) { e.textContent = p.say; e.hidden = false; }
    const input = box.querySelector('input,select,textarea');
    if (input) input.focus();
    box.scrollIntoView({ block:'center', behavior:'smooth' });
  }
}
function paint() {
  const p = overall();
  $('#pcBar').style.width = p + '%';
  $('#pcPill').textContent = p + '% complete';
  drawNav();
}

$('#secNav').addEventListener('click', e => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  readForm(); save();
  cur = +b.dataset.i;
  drawForm(); paint();
});
/* Moving between sections keeps whatever has been typed, whether or not it is
   valid — losing an answer because a phone number is half entered is worse
   than holding an invalid one. Only SAVE is gated. */
const goTo = i => {
  readForm(); save();
  cur = (i + SECTIONS.length) % SECTIONS.length;
  drawForm(); paint();
  window.scrollTo({top: 0, behavior: 'smooth'});
};

$('#saveBtn').addEventListener('click', () => {
  readForm();
  const bad = firstProblem();
  if (bad) {
    drawForm(); paint();
    showProblem(bad);
    toast(bad.say, 'bad');
    return;
  }
  save(); drawForm(); paint();
  toast('Saved. ' + overall() + '% of your profile is complete.');
});
$('#prevBtn').addEventListener('click', () => goTo(cur - 1));
$('#nextBtn').addEventListener('click', () => goTo(cur + 1));
/* ------------------------------------------------------ deleting the account
 *
 * Two gates, and the second one is the email typed out rather than a checkbox,
 * because this is irreversible and a deliberate action should take a deliberate
 * amount of effort. The server checks both again — a confirmation a browser
 * enforces is a suggestion. */
$('#delOpen').addEventListener('click', () => {
  $('#delConfirm').hidden = false;
  $('#delOpen').hidden = true;
  $('#delEmail').focus();
});
$('#delCancel').addEventListener('click', () => {
  $('#delConfirm').hidden = true;
  $('#delOpen').hidden = false;
  $('#delErr').hidden = true;
  $('#delEmail').value = ''; $('#delPass').value = '';
});
$('#delGo').addEventListener('click', async () => {
  const err = $('#delErr');
  err.hidden = true;
  const btn = $('#delGo');
  btn.disabled = true;
  const was = btn.textContent;
  btn.textContent = 'Deleting…';
  try {
    const out = await api('DELETE', '/api/account', {
      email: $('#delEmail').value, password: $('#delPass').value,
    });
    /* Straight out, and told what happened on the way. Leaving them on a
       screen whose account no longer exists would be the last thing this
       site ever showed them. */
    try { localStorage.clear(); } catch (e) {}
    location.href = 'index.html?gone=1'
      + (out && out.ordersKept ? '&kept=' + out.ordersKept : '');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = was;
    err.textContent = e.message || 'That did not work. Try again.';
    err.hidden = false;
  }
});

$('#fillBtn').addEventListener('click', () => {
  Object.assign(DB.profile, DEMO); save(); drawForm(); paint();
  toast('Filled with demo answers — every section is now complete.');
});

drawForm(); paint();
"""
