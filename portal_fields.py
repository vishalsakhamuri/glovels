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
/* ---------------------------------------------------------------- helpers
 *
 * A year of passing was a `number` box. Vishal, three times over: "the
 * dropdown must display the values of Years Ex: 1997. Presently it is
 * displaying the dropdown as 1,2,3,4,5,6" — what he was seeing is the
 * browser's own suggestion list for a numeric field, which is not a list of
 * years and never will be. A list of years is a list of years.
 *
 * Built at render time from today, so it does not go stale in a year. `ahead`
 * lets a degree still in progress be finished next year or the one after.
 */
function YEARS(back, ahead) {
  const now = new Date().getFullYear();
  const out = [''];
  for (let y = now + (ahead || 0); y >= now - back; y--) out.push(String(y));
  return out;
}

/* Only the tests that report band scores per skill. A Medium of Instruction
   letter has no bands, and asking for four of them makes a profile that can
   never reach 100%. */
const BANDED = p => /ielts|toefl|pte/i.test(String(p.e_test || ''));

const SECTIONS = [
  {id:'personal', icon:'i-user', name:'Personal details', fields:[
    {k:'fullName', l:'Full name (as on passport)', t:'text', ph:'Vishal Sakhamuri'},
    {k:'dob',      l:'Date of birth', t:'date3', back:70},
    {k:'gender',   l:'Gender', t:'select', o:['','Female','Male','Other','Prefer not to say']},
    {k:'city',     l:'City', t:'text', ph:'Hyderabad'},
    /* Mandatory, and said so on the label rather than only in the meter. These
       two are how the office reaches somebody; a record without them is a
       record nobody can act on. */
    {k:'phone',    l:'Mobile number', t:'tel', ph:'98765 43210', must:1,
     help:'Indian mobile, 10 digits starting 6-9.'},
    {k:'email',    l:'Email', t:'email', ph:'you@email.com', must:1},
    {k:'alt_phone',l:'Alternate contact number', t:'tel', ph:'98765 43210', opt:()=>true}
  ]},
  /* Optional in full. A student with no second number is not an incomplete
     student, so nothing here counts against the meter. */
  {id:'family', icon:'i-user', name:'Family details', opt:1, fields:[
    {k:'fam_name',  l:"Parent or guardian's name", t:'text', ph:'Full name', opt:()=>true},
    {k:'fam_phone', l:"Parent or guardian's mobile", t:'tel', ph:'98765 43210', opt:()=>true},
    {k:'fam_rel',   l:'Relationship', t:'select', opt:()=>true,
     o:['','Father','Mother','Guardian','Sibling','Spouse','Other']}
  ]},
  {id:'tenth', icon:'i-file', name:'Class 10', fields:[
    {k:'x_board', l:'Board', t:'select', o:['','CBSE','ICSE','State board','IB','Other']},
    {k:'x_year',  l:'Year of passing', t:'select', years:[40, 0]},
    {k:'x_score', l:'Percentage / CGPA', t:'text', ph:'88% or 8.8'},
    {k:'x_school',l:'School', t:'text', ph:'School name'}
  ]},
  {id:'twelfth', icon:'i-file', name:'Class 12', fields:[
    {k:'xii_board',  l:'Board', t:'select', o:['','CBSE','ICSE','State board','IB','Other']},
    {k:'xii_year',   l:'Year of passing', t:'select', years:[40, 0]},
    {k:'xii_score',  l:'Percentage / CGPA', t:'text', ph:'91% or 9.1'},
    {k:'xii_stream', l:'Stream', t:'select', o:['','Science (PCM)','Science (PCB)','Commerce','Arts / Humanities','Other']}
  ]},
  {id:'degree', icon:'i-cap', name:'Bachelor degree', fields:[
    {k:'d_uni',    l:'University', t:'text', ph:'JNTU Hyderabad'},
    {k:'d_course', l:'Course', t:'text', ph:'B.Tech Electronics & Communication'},
    {k:'d_dur',    l:'Duration', t:'select', o:['','3 years','4 years','5 years']},
    /* Two years ahead: a final-year student applying now has not finished. */
    {k:'d_year',   l:'Year of completion', t:'select', years:[40, 2]},
    {k:'d_cgpa',   l:'CGPA (out of 10)', t:'text', ph:'7.6',
     help:'German public universities usually look for 7.5+. Below that we look at pathway routes.'},
    {k:'d_backlog',l:'Active backlogs', t:'select', o:['','None','1-2','3-5','More than 5']}
  ]},
  {id:'english', icon:'i-star', name:'English test', fields:[
    {k:'e_test',  l:'Test taken', t:'select', o:['','IELTS','TOEFL','PTE','Duolingo','Medium of Instruction letter','Not taken yet']},
    {k:'e_score', l:'Overall score', t:'text', ph:'7.0'},
    {k:'e_date',  l:'Test date', t:'date3', back:6, ahead:2},
    {k:'e_low',   l:'Lowest band', t:'text', ph:'6.5',
     help:'Most German and UK programmes require no band below 6.0.'},
    /* Per skill, because a university asks per skill. A 7.0 overall with a 5.5
       in writing is refused by programmes a 6.5 flat would pass. */
    {k:'e_listen', l:'Listening', t:'text', ph:'7.0', opt:p=>!BANDED(p)},
    {k:'e_read',   l:'Reading',   t:'text', ph:'7.5', opt:p=>!BANDED(p)},
    {k:'e_write',  l:'Writing',   t:'text', ph:'6.5', opt:p=>!BANDED(p)},
    {k:'e_speak',  l:'Speaking',  t:'text', ph:'7.0', opt:p=>!BANDED(p)}
  ]},
  {id:'aptitude', icon:'i-star', name:'GRE / GMAT / SAT', fields:[
    {k:'a_test',  l:'Test', t:'select', o:['','Not required','GRE','GMAT','SAT','Planning to take']},
    {k:'a_score', l:'Score', t:'text', ph:'318', opt:p=>!p.a_test||/not required|planning/i.test(p.a_test)},
    {k:'a_date',  l:'Test date', t:'date3', back:6, ahead:2,
     opt:p=>!p.a_test||/not required|planning/i.test(p.a_test)}
  ]},
  {id:'work', icon:'i-plane', name:'Work experience', fields:[
    {k:'w_has',   l:'Do you have work experience?', t:'select', o:['','No','Yes - internship','Yes - full time']},
    {k:'w_emp',   l:'Employer', t:'text', ph:'Company name', opt:p=>/^no$/i.test(p.w_has||'')},
    {k:'w_role',  l:'Role', t:'text', ph:'Software Engineer', opt:p=>/^no$/i.test(p.w_has||'')},
    {k:'w_months',l:'Months of experience', t:'number', ph:'18', opt:p=>/^no$/i.test(p.w_has||'')}
  ]},
  {id:'goals', icon:'i-shield', name:'Goals', fields:[
    {k:'g_level',  l:'What are you applying for?', t:'select', o:['','Master\'s','Bachelor\'s','MBA','Foundation / Pathway','PhD','Diploma / PG Diploma']},
    {k:'g_field',  l:'Field', t:'text', ph:'Data Science'},
    /* More than one. A student deciding between Germany and Poland was being
       made to pick one before we would show them anything. */
    {k:'g_country',l:'Preferred destinations', t:'multi',
     o:['Germany','Canada','United Kingdom','Ireland','Poland','Spain','Italy','Open to advice'],
     help:'Choose as many as you are considering. Your matches cover all of them.'},
    {k:'g_intake', l:'Target intake', t:'select', o:['','Winter 2026','Summer 2027','Winter 2027','Summer 2028']},
    {k:'g_why',    l:'Why this course, in your words', t:'textarea',
     ph:'A few honest sentences. Your SOP is drafted from this, so specifics beat adjectives.'}
  ]},
  {id:'budget', icon:'i-wallet', name:'Budget & funding', fields:[
    {k:'b_total', l:'Budget for the whole programme', t:'multi',
     o:['Under ₹10 Lakhs','₹10-20 Lakhs','₹20-40 Lakhs','Above ₹40 Lakhs'],
     help:'More than one band is fine. Matches are shown up to the highest you pick.'},
    {k:'b_fund',  l:'How will it be funded?', t:'select',
     o:['','Family savings','Education loan','Scholarship','A mix','Not decided']},
    {k:'b_loan',  l:'Do you want loan assistance?', t:'select', o:['','Yes','No','Tell me more']},
    {k:'b_spons', l:'Sponsor', t:'select', o:['','Parent','Self','Relative','Other']}
  ]},
  {id:'recommenders', icon:'i-mail', name:'Recommenders', groups:{
    r1:{name:'Recommender 1', tone:'blue', note:'Usually your head of department or project guide.'},
    r2:{name:'Recommender 2', tone:'green', note:'Optional. A manager, or a second professor.'}
  }, fields:[
    /* Two people, two blocks. Six fields in one column with the name of the
       person only in the label is how a manager's email ends up under a
       professor's name. */
    {k:'r1_name', l:'Name', t:'text', ph:'Prof. name', grp:'r1'},
    {k:'r1_role', l:'Designation', t:'text', ph:'Head of Department, ECE', grp:'r1'},
    {k:'r1_mail', l:'Email', t:'email', ph:'name@college.edu', grp:'r1'},
    {k:'r2_name', l:'Name', t:'text', ph:'Manager or professor', opt:()=>true, grp:'r2'},
    {k:'r2_role', l:'Designation', t:'text', opt:()=>true, grp:'r2'},
    {k:'r2_mail', l:'Email', t:'email', opt:()=>true, grp:'r2'}
  ]},
  {id:'passport', icon:'i-shield', name:'Passport & visa', fields:[
    {k:'p_has',   l:'Do you have a passport?', t:'select', o:['','Yes','Applied for','Not yet']},
    {k:'p_num',   l:'Passport number', t:'text', ph:'M1234567', opt:p=>!/^yes$/i.test(p.p_has||'')},
    /* Three lists, not a date box. Vishal: "backspace does not work for Expiry
       date of passport". A native date input is a set of segments, not text —
       what a backspace does to it depends on the browser, and on a phone there
       is no keyboard at all. Nothing here needs correcting because nothing
       here is typed. */
    {k:'p_exp',   l:'Expiry date', t:'date3', back:2, ahead:15,
     opt:p=>!/^yes$/i.test(p.p_has||''),
     help:'It must stay valid for the whole course plus three months.'},
    {k:'p_refuse',l:'Any previous visa refusal?', t:'select', o:['','No','Yes'],
     help:'A refusal is not a blocker, but it must be declared. Hiding one is.'},
    /* Only when there is something to say, and never required. A box asking
       what happened, shown to somebody who answered No, reads as an accusation. */
    {k:'p_refuse_why', l:'What happened?', t:'textarea', opt:()=>true,
     show:p=>/^yes$/i.test(p.p_refuse||''),
     ph:'Which country, roughly when, and the reason given. Your counsellor '
      + 'needs it to answer the question the next form will ask.'}
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
  /* `ours` means WE write it and hand it back — the screens show a download
     rather than an upload box, and it arrives verified because the person who
     would verify it is the person who wrote it. */
  {id:'sop',      name:'Statement of Purpose',  need:1, ours:1,
   blocks:'University application'},
  {id:'lor',      name:'Letters of Recommendation', need:1, ours:1,
   blocks:'University application'},
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
  /* Written by the counsellor, not collected from the student. It is the
     letter that explains the application to the consulate, and it goes out
     with the file rather than being asked for. */
  {id:'visa-cover',      name:'Visa cover letter',          need:1, ours:1,
   blocks:'Nothing — it goes with the file. We write it once the offer is in'},
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
