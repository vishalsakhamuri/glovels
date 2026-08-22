"""My Profile — the 11-section intake with a live completeness meter."""

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

    <div class="p-cols" style="grid-template-columns:230px 1fr;align-items:start">
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
const SECTIONS = [
  {id:'personal', icon:'i-user', name:'Personal details', fields:[
    {k:'fullName', l:'Full name (as on passport)', t:'text', ph:'Vishal Sakhamuri'},
    {k:'dob',      l:'Date of birth', t:'date'},
    {k:'gender',   l:'Gender', t:'select', o:['','Female','Male','Other','Prefer not to say']},
    {k:'city',     l:'City', t:'text', ph:'Hyderabad'},
    {k:'phone',    l:'Mobile number', t:'tel', ph:'98765 43210', help:'Indian mobile, 10 digits starting 6–9.'},
    {k:'email',    l:'Email', t:'email', ph:'you@email.com'}
  ]},
  {id:'tenth', icon:'i-file', name:'Class 10', fields:[
    {k:'x_board', l:'Board', t:'select', o:['','CBSE','ICSE','State board','IB','Other']},
    {k:'x_year',  l:'Year of passing', t:'number', ph:'2018'},
    {k:'x_score', l:'Percentage / CGPA', t:'text', ph:'88% or 8.8'},
    {k:'x_school',l:'School', t:'text', ph:'School name'}
  ]},
  {id:'twelfth', icon:'i-file', name:'Class 12', fields:[
    {k:'xii_board',  l:'Board', t:'select', o:['','CBSE','ICSE','State board','IB','Other']},
    {k:'xii_year',   l:'Year of passing', t:'number', ph:'2020'},
    {k:'xii_score',  l:'Percentage / CGPA', t:'text', ph:'91% or 9.1'},
    {k:'xii_stream', l:'Stream', t:'select', o:['','Science (PCM)','Science (PCB)','Commerce','Arts / Humanities','Other']}
  ]},
  {id:'degree', icon:'i-cap', name:'Bachelor degree', fields:[
    {k:'d_uni',    l:'University', t:'text', ph:'JNTU Hyderabad'},
    {k:'d_course', l:'Course', t:'text', ph:'B.Tech Electronics & Communication'},
    {k:'d_dur',    l:'Duration', t:'select', o:['','3 years','4 years','5 years']},
    {k:'d_year',   l:'Year of completion', t:'number', ph:'2024'},
    {k:'d_cgpa',   l:'CGPA (out of 10)', t:'text', ph:'7.6',
     help:'German public universities usually look for 7.5+. Below that we look at pathway routes.'},
    {k:'d_backlog',l:'Active backlogs', t:'select', o:['','None','1–2','3–5','More than 5']}
  ]},
  {id:'english', icon:'i-star', name:'English test', fields:[
    {k:'e_test',  l:'Test taken', t:'select', o:['','IELTS','TOEFL','PTE','Duolingo','Medium of Instruction letter','Not taken yet']},
    {k:'e_score', l:'Overall score', t:'text', ph:'7.0'},
    {k:'e_date',  l:'Test date', t:'date'},
    {k:'e_low',   l:'Lowest band', t:'text', ph:'6.5',
     help:'Most German and UK programmes require no band below 6.0.'}
  ]},
  {id:'aptitude', icon:'i-star', name:'GRE / GMAT / SAT', fields:[
    {k:'a_test',  l:'Test', t:'select', o:['','Not required','GRE','GMAT','SAT','Planning to take']},
    {k:'a_score', l:'Score', t:'text', ph:'318', opt:p=>!p.a_test||/not required|planning/i.test(p.a_test)},
    {k:'a_date',  l:'Test date', t:'date', opt:p=>!p.a_test||/not required|planning/i.test(p.a_test)}
  ]},
  {id:'work', icon:'i-plane', name:'Work experience', fields:[
    {k:'w_has',   l:'Do you have work experience?', t:'select', o:['','No','Yes — internship','Yes — full time']},
    {k:'w_emp',   l:'Employer', t:'text', ph:'Company name', opt:p=>/^no$/i.test(p.w_has||'')},
    {k:'w_role',  l:'Role', t:'text', ph:'Software Engineer', opt:p=>/^no$/i.test(p.w_has||'')},
    {k:'w_months',l:'Months of experience', t:'number', ph:'18', opt:p=>/^no$/i.test(p.w_has||'')}
  ]},
  {id:'goals', icon:'i-shield', name:'Goals', fields:[
    {k:'g_level',  l:'What are you applying for?', t:'select', o:['','Master\'s','Bachelor\'s','MBA','Foundation / Pathway','PhD','Diploma / PG Diploma']},
    {k:'g_field',  l:'Field', t:'text', ph:'Data Science'},
    {k:'g_country',l:'Preferred destination', t:'select', o:['','Germany','Canada','United Kingdom','Ireland','Poland','Spain','Italy','Open to advice']},
    {k:'g_intake', l:'Target intake', t:'select', o:['','Winter 2026','Summer 2027','Winter 2027','Summer 2028']},
    {k:'g_why',    l:'Why this course, in your words', t:'textarea',
     ph:'A few honest sentences. Your SOP is drafted from this, so specifics beat adjectives.'}
  ]},
  {id:'budget', icon:'i-wallet', name:'Budget & funding', fields:[
    {k:'b_total', l:'Budget for the whole programme', t:'select',
     o:['','Under ₹10 Lakhs','₹10–20 Lakhs','₹20–40 Lakhs','Above ₹40 Lakhs']},
    {k:'b_fund',  l:'How will it be funded?', t:'select',
     o:['','Family savings','Education loan','Scholarship','A mix','Not decided']},
    {k:'b_loan',  l:'Do you want loan assistance?', t:'select', o:['','Yes','No','Tell me more']},
    {k:'b_spons', l:'Sponsor', t:'select', o:['','Parent','Self','Relative','Other']}
  ]},
  {id:'recommenders', icon:'i-mail', name:'Recommenders', fields:[
    {k:'r1_name', l:'Recommender 1 — name', t:'text', ph:'Prof. name'},
    {k:'r1_role', l:'Recommender 1 — designation', t:'text', ph:'Head of Department, ECE'},
    {k:'r1_mail', l:'Recommender 1 — email', t:'email', ph:'name@college.edu'},
    {k:'r2_name', l:'Recommender 2 — name', t:'text', ph:'Manager or professor', opt:()=>true},
    {k:'r2_role', l:'Recommender 2 — designation', t:'text', opt:()=>true},
    {k:'r2_mail', l:'Recommender 2 — email', t:'email', opt:()=>true}
  ]},
  {id:'passport', icon:'i-shield', name:'Passport & visa', fields:[
    {k:'p_has',   l:'Do you have a passport?', t:'select', o:['','Yes','Applied for','Not yet',]},
    {k:'p_num',   l:'Passport number', t:'text', ph:'M1234567', opt:p=>!/^yes$/i.test(p.p_has||'')},
    {k:'p_exp',   l:'Expiry date', t:'date', opt:p=>!/^yes$/i.test(p.p_has||''),
     help:'It must stay valid for the whole course plus three months.'},
    {k:'p_refuse',l:'Any previous visa refusal?', t:'select', o:['','No','Yes'],
     help:'A refusal is not a blocker, but it must be declared. Hiding one is.'}
  ]}
];

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
