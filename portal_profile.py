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
          <button type="button" class="btn btn-primary" id="saveBtn">Save this section</button>
          <button type="button" class="btn btn-ghost" id="nextBtn">Next section →</button>
          <button type="button" class="btn btn-ghost" id="fillBtn"
            style="margin-left:auto">Fill with demo answers</button>
        </div>
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
  fullName:'Vishal Sakhamuri', dob:'2002-04-11', gender:'Male', city:'Hyderabad',
  phone:'98765 43210', email:'student@glovels.com',
  x_board:'CBSE', x_year:'2018', x_score:'88%', x_school:'Delhi Public School',
  xii_board:'CBSE', xii_year:'2020', xii_score:'91%', xii_stream:'Science (PCM)',
  d_uni:'JNTU Hyderabad', d_course:'B.Tech Electronics & Communication', d_dur:'4 years',
  d_year:'2024', d_cgpa:'7.6', d_backlog:'None',
  e_test:'IELTS', e_score:'7.0', e_date:'2026-03-14', e_low:'6.5',
  a_test:'Not required', a_score:'', a_date:'',
  w_has:'Yes — internship', w_emp:'Qualcomm India', w_role:'Intern, Embedded Systems', w_months:'6',
  g_level:"Master's", g_field:'Data Science', g_country:'Germany', g_intake:'Winter 2026',
  g_why:'I built a fault-detection model for my final-year project and want to take it further where the research and the industry sit close together.',
  b_total:'Under ₹10 Lakhs', b_fund:'A mix', b_loan:'Yes', b_spons:'Parent',
  r1_name:'Prof. S. Raghavan', r1_role:'Head of Department, ECE', r1_mail:'raghavan@jntuh.ac.in',
  r2_name:'Anita Menon', r2_role:'Engineering Manager, Qualcomm', r2_mail:'anita.menon@example.com',
  p_has:'Yes', p_num:'M4471902', p_exp:'2031-08-02', p_refuse:'No'
};

DB.profile = DB.profile || {};
let cur = 0;

/* A field that does not apply to you must not hold your profile below 100%.
   "GRE score" is not missing when the answer to "GRE?" is "not required" — it is
   answered. Counting it as missing is how a completeness meter becomes a number
   nobody can ever clear, and then nobody trusts. */
const needed = f => !(f.opt && f.opt(DB.profile));
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
  $('#pForm').innerHTML =
    '<div class="p-card"><h3>' + ico(s.icon.replace('i-','')) + ' ' + esc(s.name.replace('&amp;','&')) +
    '<span class="pill">' + pctOf(s) + '% done</span></h3>' +
    s.fields.map(f => {
      const v = DB.profile[f.k] || '';
      let input;
      if (f.t === 'select') {
        input = '<select name="' + f.k + '">' + f.o.map(o =>
          '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' +
          (o === '' ? 'Select…' : esc(o)) + '</option>').join('') + '</select>';
      } else if (f.t === 'textarea') {
        input = '<textarea name="' + f.k + '" rows="4" placeholder="' + esc(f.ph || '') + '" style="' +
          'width:100%;padding:12px;font:400 14px/1.6 var(--sans);color:var(--navy-900);' +
          'border:1.5px solid #d8dde4;border-radius:var(--r);resize:vertical">' + esc(v) + '</textarea>';
      } else {
        input = '<input type="' + f.t + '" name="' + f.k + '" value="' + esc(v) +
          '" placeholder="' + esc(f.ph || '') + '">';
      }
      return '<div class="field" style="margin-bottom:15px"><label>' + esc(f.l) +
        (needed(f) ? '' : '<span style="margin-left:auto;font-weight:700;color:var(--muted);' +
          'text-transform:none;letter-spacing:0">optional</span>') + '</label>' + input +
        (f.help ? '<p style="margin:6px 0 0;font-size:11.8px;color:var(--muted);line-height:1.5">' +
          esc(f.help) + '</p>' : '') + '</div>';
    }).join('') + '</div>';
  // The select styling expects .field; textareas need the same focus ring.
  /* Answering "GRE: not required" has to re-score the section on the spot,
     not on the next save — otherwise the meter argues with the form. */
  $$('#pForm select').forEach(s => s.addEventListener('change', () => {
    readForm(); save(); drawForm(); paint();
  }));
  $$('#pForm textarea').forEach(t => {
    t.addEventListener('focus', () => { t.style.borderColor = 'var(--blue)'; t.style.boxShadow = '0 0 0 4px rgba(26,79,180,.16)'; });
    t.addEventListener('blur',  () => { t.style.borderColor = '#d8dde4'; t.style.boxShadow = 'none'; });
  });
}

function readForm() {
  $$('#pForm [name]').forEach(el => { DB.profile[el.name] = el.value; });
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
$('#saveBtn').addEventListener('click', () => {
  readForm(); save(); drawForm(); paint();
  toast('Saved. ' + overall() + '% of your profile is complete.');
});
$('#nextBtn').addEventListener('click', () => {
  readForm(); save();
  cur = (cur + 1) % SECTIONS.length;
  drawForm(); paint();
  window.scrollTo({top: 0, behavior: 'smooth'});
});
$('#fillBtn').addEventListener('click', () => {
  Object.assign(DB.profile, DEMO); save(); drawForm(); paint();
  toast('Filled with demo answers — every section is now complete.');
});

drawForm(); paint();
"""
