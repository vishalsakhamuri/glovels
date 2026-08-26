"""The student's own record, as one list of fields.

Lifted out of `portal_profile.py` so the PARTNER portal can render the same
form. An agency doing the paperwork on a student's behalf must be filling in
the same record the counsellor, the matcher and the alerts all read — and two
hand-maintained copies of a field list is exactly how the two screens start
disagreeing about what a student was asked.

The comment that used to sit above this in portal_profile.py said the same
thing about the dashboard and the alerts. It has one more reader now.
"""

SECTIONS_JS = r"""
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
"""


# The two document checklists, for the same reason as the fields above: a
# partner uploading a student's marksheets is filling the SAME document slots
# the student's own screen shows and the counsellor verifies. Two copies of
# these lists is two screens that disagree about what a passport is called.

DOCS_JS = r"""
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
"""

VISA_JS = r"""
const VISA_DOCS = [
  {id:'visa-offer',      name:'Offer / admission letter',   need:1,
   blocks:'Everything after it — the visa file starts here'},
  {id:'visa-funds',      name:'Blocked account or proof of funds', need:1,
   blocks:'Visa appointment. Germany needs the blocked account confirmation itself'},
  {id:'visa-insurance',  name:'Travel and health insurance', need:1,
   blocks:'Visa appointment — cover must satisfy the consulate'},
  {id:'visa-form',       name:'Completed visa application form', need:1,
   blocks:'The appointment. We check it line by line before you sign'},
  {id:'visa-appointment',name:'Appointment confirmation',   need:1,
   blocks:'Nothing, but it fixes every date after it'},
  {id:'visa-police',     name:'Police clearance certificate', need:0,
   blocks:'Some destinations only — your counsellor will say'},
  {id:'visa-decision',   name:'Visa decision letter',       need:0,
   blocks:'Tickets and accommodation. Upload it the day it arrives'},
  {id:'visa-travel',     name:'Ticket and accommodation',   need:0,
   blocks:'Pre-departure briefing and city registration'}
];
"""
