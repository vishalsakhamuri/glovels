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

/* The boards a school-leaving certificate in India actually comes from.
 *
 * "If they select state board, provide an option to enter state board. Drop
 * down list selecting all the 10th boards in india."
 *
 * One list rather than "State board" and a box, because a typed board name is
 * a board name spelled thirty ways, and the office is the one who then has to
 * match it against what a university will accept. Every state board is named
 * in full with its abbreviation, so somebody looking for "SSC" and somebody
 * looking for "BSEAP" both find the Andhra Pradesh line.
 *
 * "Other" is last and opens a box. A list that cannot be escaped is a list
 * that gets the wrong answer chosen from it. */
const BOARDS_X = ['',
  'CBSE — Central Board of Secondary Education',
  'CISCE (ICSE) — Council for the Indian School Certificate Examinations',
  'NIOS — National Institute of Open Schooling',
  'IB — International Baccalaureate (MYP)',
  'Cambridge — IGCSE / O Level',
  'Andhra Pradesh — BSEAP (SSC)',
  'Assam — SEBA',
  'Bihar — BSEB',
  'Chhattisgarh — CGBSE',
  'Delhi — CBSE (see CBSE above)',
  'Goa — GBSHSE',
  'Gujarat — GSEB',
  'Haryana — BSEH',
  'Himachal Pradesh — HPBOSE',
  'Jammu & Kashmir — JKBOSE',
  'Jharkhand — JAC',
  'Karnataka — KSEEB (SSLC)',
  'Kerala — KBPE (SSLC)',
  'Madhya Pradesh — MPBSE',
  'Maharashtra — MSBSHSE (SSC)',
  'Manipur — BSEM',
  'Meghalaya — MBOSE',
  'Mizoram — MBSE',
  'Nagaland — NBSE',
  'Odisha — BSE Odisha (HSC)',
  'Punjab — PSEB',
  'Rajasthan — RBSE',
  'Tamil Nadu — DGE (SSLC)',
  'Telangana — BSE Telangana (SSC)',
  'Tripura — TBSE',
  'Uttar Pradesh — UP Board (High School)',
  'Uttarakhand — UBSE',
  'West Bengal — WBBSE (Madhyamik)',
  'Other'];

/* Class 12 is a different set of boards from Class 10 in most states — the
   intermediate and higher-secondary councils are separate bodies with separate
   names, and offering a student the Class 10 list here is how "BSEAP" ends up
   on a form that should say "BIEAP". */
const BOARDS_XII = ['',
  'CBSE — Central Board of Secondary Education',
  'CISCE (ISC) — Council for the Indian School Certificate Examinations',
  'NIOS — National Institute of Open Schooling',
  'IB — International Baccalaureate (Diploma)',
  'Cambridge — A Level / AS Level',
  'Andhra Pradesh — BIEAP (Intermediate)',
  'Assam — AHSEC',
  'Bihar — BSEB (Intermediate)',
  'Chhattisgarh — CGBSE',
  'Goa — GBSHSE',
  'Gujarat — GSHSEB',
  'Haryana — BSEH',
  'Himachal Pradesh — HPBOSE',
  'Jammu & Kashmir — JKBOSE',
  'Jharkhand — JAC',
  'Karnataka — KSEAB (2nd PUC)',
  'Kerala — DHSE (Plus Two)',
  'Madhya Pradesh — MPBSE',
  'Maharashtra — MSBSHSE (HSC)',
  'Manipur — COHSEM',
  'Meghalaya — MBOSE',
  'Mizoram — MBSE',
  'Nagaland — NBSE',
  'Odisha — CHSE Odisha',
  'Punjab — PSEB',
  'Rajasthan — RBSE',
  'Tamil Nadu — DGE (HSC)',
  'Telangana — TSBIE (Intermediate)',
  'Tripura — TBSE',
  'Uttar Pradesh — UP Board (Intermediate)',
  'Uttarakhand — UBSE',
  'West Bengal — WBCHSE (Higher Secondary)',
  'Other'];

const OTHER = k => p => /^other$/i.test(String(p[k] || ''));

const SECTIONS = [
  {id:'personal', icon:'i-user', name:'Personal details', fields:[
    /* Two boxes, not one.
     *
     * Every university form, every visa form and every airline ticket asks for
     * a given name and a surname separately, and half of them reject a name
     * split the wrong way. Asking for one "full name" and splitting it
     * ourselves means guessing which half is which — and for a great many
     * Indian names the guess is wrong, because the surname comes first.
     *
     * `fullName` still exists and is still what the account, the matcher, the
     * alerts and the counsellor's screen read. It is composed from these two
     * on save, on the server, so nothing downstream had to change and a record
     * written before this still reads correctly. */
    {k:'firstName', l:'First name / Given name', t:'text', ph:'Vishal',
     help:'Exactly as it is printed on your passport.'},
    {k:'lastName',  l:'Last name / Surname', t:'text', ph:'Sakhamuri'},
    {k:'dob',      l:'Date of birth', t:'date3', back:70},
    {k:'gender',   l:'Gender', t:'select', o:['','Female','Male','Other','Prefer not to say']},
    /* Asked because the forms ask. A German application and a UK visa both
       want the town on the passport, and a student who has to go and find
       their passport halfway through a form usually does not come back. */
    {k:'pob',      l:'Place of birth (as on passport)', t:'text', ph:'Hyderabad'},
    /* Mandatory, and said so on the label rather than only in the meter. These
       two are how the office reaches somebody; a record without them is a
       record nobody can act on. */
    {k:'phone',    l:'Mobile number', t:'tel', ph:'98765 43210', must:1,
     help:'Indian mobile, 10 digits starting 6-9.'},
    {k:'email',    l:'Email', t:'email', ph:'you@email.com', must:1},
    {k:'alt_phone',l:'Alternate contact number', t:'tel', ph:'98765 43210', opt:()=>true}
  ]},
  /* Where they live. Every university form has this block and every one of
     them wants it in these pieces; a single "address" box is retyped by
     somebody in the office for every application. `city` keeps its old key so
     a record written before this section existed still has its city. */
  /* i-globe, not i-pin. The portal sprite has no pin in it, and a <use> on a
     symbol that is not there renders nothing at all — no icon, no error, and a
     section heading sitting in a blank space where every other one has a
     picture. That has caught this build twice already. */
  {id:'address', icon:'i-globe', name:'Address', fields:[
    {k:'addr1',   l:'Address line 1', t:'text', ph:'Flat / house, street'},
    {k:'addr2',   l:'Address line 2', t:'text', ph:'Area, landmark', opt:()=>true},
    {k:'city',    l:'City / Town', t:'text', ph:'Hyderabad'},
    {k:'state',   l:'State', t:'text', ph:'Telangana'},
    {k:'pin',     l:'PIN code', t:'text', ph:'500081',
     help:'Six digits.'},
    {k:'addr_country', l:'Country', t:'text', ph:'India'}
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
    {k:'x_board', l:'Board', t:'select', o:BOARDS_X},
    /* Only when the list did not have it, and never required — a box asking
       which board, shown to somebody who found theirs on the list, is a
       question with no answer. */
    {k:'x_board_other', l:'Which board?', t:'text', ph:'Name of the board',
     opt:()=>true, show:OTHER('x_board')},
    {k:'x_year',  l:'Year of passing', t:'select', years:[40, 0]},
    {k:'x_score', l:'Percentage / CGPA', t:'text', ph:'88% or 8.8'},
    {k:'x_school',l:'School', t:'text', ph:'School name'}
  ]},
  {id:'twelfth', icon:'i-file', name:'Class 12', fields:[
    {k:'xii_board',  l:'Board', t:'select', o:BOARDS_XII},
    {k:'xii_board_other', l:'Which board?', t:'text', ph:'Name of the board',
     opt:()=>true, show:OTHER('xii_board')},
    {k:'xii_year',   l:'Year of passing', t:'select', years:[40, 0]},
    {k:'xii_score',  l:'Percentage / CGPA', t:'text', ph:'91% or 9.1'},
    {k:'xii_stream', l:'Stream', t:'select', o:['','Science (PCM)','Science (PCB)','Commerce','Arts / Humanities','Other']}
  ]},
  {id:'degree', icon:'i-cap', name:'Bachelor degree', fields:[
    {k:'d_uni',    l:'University', t:'text', ph:'JNTU Hyderabad'},
    {k:'d_course', l:'Course', t:'text', ph:'B.Tech Electronics & Communication'},
    {k:'d_dur',    l:'Duration', t:'select', o:['','3 years','4 years','5 years']},
    /* When they started. Asked because a university form asks, and because a
       gap between school and college is the thing a visa officer notices and
       a counsellor should know about before the form does. */
    {k:'d_start',  l:'Year of joining', t:'select', years:[40, 0]},
    /* Two years ahead: a final-year student applying now has not finished. */
    {k:'d_year',   l:'Year of completion', t:'select', years:[40, 2]},
    {k:'d_cgpa',   l:'Your overall grade', t:'text', ph:'7.6',
     help:'Whatever your transcript prints — a CGPA, a percentage, whatever your '
        + 'university uses. The two boxes below say what scale it is on.'},
    /* The student's OWN university's scale, and the reason it is asked rather
     * than assumed.
     *
     * German applications are judged on a 1.0-4.0 grade converted from this
     * one with the Modified Bavarian Formula, and the pass mark is the
     * parameter that decides the answer: the same 6.84 is 2.5 where the pass
     * mark is 4 and 2.8 where it is 5. Nought point three of a grade, and 2.5
     * gets into programmes 2.8 does not.
     *
     * So it comes from them. 10 is offered as a maximum because most Indian
     * universities use it; the pass mark is deliberately given NO default,
     * because a default here is a wrong answer for half of them. */
    {k:'d_max',    l:'Maximum grade at your university', t:'text', ph:'10',
     help:'10 for most Indian CGPAs. 100 if your transcript is in percent, 4 on a GPA.'},
    {k:'d_pass',   l:'Minimum passing grade at your university', t:'text', ph:'4',
     help:'It differs at every university \u2014 it is in your academic regulations '
        + 'and printed on many transcripts. We will not guess it: without it we '
        + 'can only show your German grade as a range.'},
    /* Total, not active.
     *
     * A university form asks how many subjects were ever failed, not how many
     * are outstanding today — a student who cleared all six last term answers
     * "None" to "active backlogs" and the form they eventually sign says
     * something different from what they told us. */
    {k:'d_backlog',l:'Total backlogs (including cleared)', t:'select',
     o:['','None','1-2','3-5','More than 5'],
     help:'Every subject you have ever failed, even if you passed it later. '
        + 'A university asks for the total; declaring it is never the problem, '
        + 'a mismatch later is.'}
  ]},
  /* Two tests, because people take two.
   *
   * "Under English test — add options for multiple tests." Somebody who sat
   * IELTS in March and PTE in July has two scorecards and two sets of bands,
   * and every university takes a different one. Asked as two blocks rather
   * than as a repeater for the same reason the recommenders are: six fields in
   * one column with only the label saying which test they belong to is how a
   * PTE score ends up filed under IELTS.
   *
   * The first block keeps its old keys, so the bands rule, the demo profile
   * and everything the counsellor screen reads still work untouched. */
  {id:'english', icon:'i-star', name:'English test', groups:{
    e1:{name:'Your test', tone:'blue', note:'The one you want us to file with.'},
    e2:{name:'A second test, if you sat one', tone:'green',
        note:'Optional. Some universities prefer one over the other.'}
  }, fields:[
    {k:'e_test',  l:'Test taken', t:'select', grp:'e1',
     o:['','IELTS','TOEFL','PTE','Duolingo','Medium of Instruction letter','Not taken yet']},
    {k:'e_score', l:'Overall score', t:'text', ph:'7.0', grp:'e1'},
    {k:'e_date',  l:'Test date', t:'date3', back:6, ahead:2, grp:'e1'},
    {k:'e_low',   l:'Lowest band', t:'text', ph:'6.5', grp:'e1',
     help:'Most German and UK programmes require no band below 6.0.'},
    /* Per skill, because a university asks per skill. A 7.0 overall with a 5.5
       in writing is refused by programmes a 6.5 flat would pass. */
    {k:'e_listen', l:'Listening', t:'text', ph:'7.0', grp:'e1', opt:p=>!BANDED(p)},
    {k:'e_read',   l:'Reading',   t:'text', ph:'7.5', grp:'e1', opt:p=>!BANDED(p)},
    {k:'e_write',  l:'Writing',   t:'text', ph:'6.5', grp:'e1', opt:p=>!BANDED(p)},
    {k:'e_speak',  l:'Speaking',  t:'text', ph:'7.0', grp:'e1', opt:p=>!BANDED(p)},
    {k:'e2_test',  l:'Test taken', t:'select', grp:'e2', opt:()=>true,
     o:['','IELTS','TOEFL','PTE','Duolingo','Cambridge English','Other']},
    {k:'e2_score', l:'Overall score', t:'text', ph:'65', grp:'e2', opt:()=>true},
    {k:'e2_date',  l:'Test date', t:'date3', back:6, ahead:2, grp:'e2', opt:()=>true},
    {k:'e2_low',   l:'Lowest band', t:'text', ph:'58', grp:'e2', opt:()=>true}
  ]},
  /* GATE belongs on this list. It is the entrance test a German university
     asks an Indian engineering applicant about most often, and it was not
     offered — so the students most likely to have one had nowhere to say so. */
  {id:'aptitude', icon:'i-star', name:'GRE / GMAT / GATE', groups:{
    a1:{name:'Your test', tone:'blue', note:'The one your programmes ask for.'},
    a2:{name:'A second test, if you sat one', tone:'green', note:'Optional.'}
  }, fields:[
    {k:'a_test',  l:'Test', t:'select', grp:'a1',
     o:['','Not required','GRE','GMAT','GATE','SAT','ACT','NEET','Planning to take']},
    {k:'a_score', l:'Score', t:'text', ph:'318', grp:'a1',
     opt:p=>!p.a_test||/not required|planning/i.test(p.a_test)},
    {k:'a_date',  l:'Test date', t:'date3', back:6, ahead:2, grp:'a1',
     opt:p=>!p.a_test||/not required|planning/i.test(p.a_test)},
    {k:'a2_test',  l:'Test', t:'select', grp:'a2', opt:()=>true,
     o:['','GRE','GMAT','GATE','SAT','ACT','NEET','Other']},
    {k:'a2_score', l:'Score', t:'text', ph:'700', grp:'a2', opt:()=>true},
    {k:'a2_date',  l:'Test date', t:'date3', back:6, ahead:2, grp:'a2', opt:()=>true}
  ]},
  {id:'work', icon:'i-plane', name:'Work experience', fields:[
    {k:'w_has',   l:'Do you have work experience?', t:'select', o:['','No','Yes - internship','Yes - full time']},
    {k:'w_emp',   l:'Employer', t:'text', ph:'Company name', opt:p=>/^no$/i.test(p.w_has||'')},
    {k:'w_role',  l:'Role', t:'text', ph:'Software Engineer', opt:p=>/^no$/i.test(p.w_has||'')},
    {k:'w_months',l:'Months of experience', t:'number', ph:'18', opt:p=>/^no$/i.test(p.w_has||'')}
  ]},
  {id:'goals', icon:'i-shield', name:'Goals', fields:[
    {k:'g_level',  l:'What are you applying for?', t:'select', o:['','Master\'s','Bachelor\'s','MBA','Foundation / Pathway','PhD','Diploma / PG Diploma']},
    /* Five, because one was a decision we were making for them.
     *
     * "Under field give upto 5 boxes so student can give more options for us,
     * instead of just 1." A student open to Data Science, AI and Computer
     * Science was being made to pick which one we would search on. The matcher
     * scores a programme on any word in common with what they typed, so all
     * five are handed to it together and a match on any of them counts.
     *
     * g_field keeps its key and stays first. It is what matches.js, the
     * counsellor's screen and the studio have always read. */
    {k:'g_field',  l:'Field', t:'text', ph:'Data Science'},
    {k:'g_field2', l:'Another field', t:'text', ph:'Artificial Intelligence', opt:()=>true},
    {k:'g_field3', l:'Another field', t:'text', ph:'Computer Science', opt:()=>true},
    {k:'g_field4', l:'Another field', t:'text', opt:()=>true},
    {k:'g_field5', l:'Another field', t:'text', opt:()=>true},
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
/* `note` is the sentence under the card. It exists because half of what the
   counsellors were correcting was not WHICH document but HOW it should arrive:
   every semester in one file, not eight; the consolidated card as well as the
   marksheets, not instead of them; all the experience letters together rather
   than one upload per employer. A checklist of nouns cannot say any of that,
   and a student who gets it wrong finds out weeks later.

   `(if available)` is in the NAME of every optional document, not only in the
   Optional chip beside it — the chip is read as "we would still like it", and
   students were chasing a degree certificate they cannot have yet. */
const DOCS = [
  {id:'passport', name:'Passport',              need:1, blocks:'Visa appointment, university application',
   note:'The photo page. It must be valid for at least six months after you land.'},
  {id:'x',        name:'Class 10 marksheet',    need:1, blocks:'University application'},
  {id:'xii',      name:'Class 12 marksheet',    need:1, blocks:'University application'},
  {id:'degree',   name:'Semester-wise marksheets', need:1, blocks:'University application, APS',
   note:'Every semester, in ONE file, in order. Not one upload per semester — a '
      + 'set that arrives in eight pieces is checked as eight documents and one '
      + 'of them always goes missing.'},
  {id:'consol',   name:'Consolidated grade card', need:1, blocks:'University application, APS',
   note:'The single sheet your university issues with every semester on it. It is '
      + 'not the same as the marksheets above, and most universities abroad ask '
      + 'for both.'},
  {id:'degcert',  name:'Original degree certificate (if available)', need:0,
   blocks:'Final admission',
   note:'The final certificate, once your university issues it. If you have not '
      + 'graduated yet, send the provisional below and this when it arrives.'},
  {id:'provis',   name:'Provisional certificate (if available)', need:0,
   blocks:'Final admission',
   note:'What your university gives you before the original is printed. It is '
      + 'accepted everywhere the original is, for admission.'},
  {id:'english',  name:'English test scorecard',need:1, blocks:'University application, visa'},
  {id:'cv',       name:'Academic CV',           need:1, blocks:'University application'},
  /* `ours` means WE write it and hand it back — the screens show a download
     rather than an upload box, and it arrives verified because the person who
     would verify it is the person who wrote it. */
  {id:'sop',      name:'Statement of Purpose',  need:1, ours:1,
   blocks:'University application'},
  {id:'lor',      name:'Letters of Recommendation', need:1, ours:1,
   blocks:'University application'},
  {id:'work',     name:'Work experience letters (if available)', need:0,
   blocks:'Some Master’s programmes count experience towards entry',
   note:'All of them in ONE file — every employer, in order, oldest first. '
      + 'Internships count.'},
  {id:'certs',    name:'Certificates and achievements (if available)', need:0,
   blocks:'Nothing on its own — it strengthens the application',
   note:'All of them in ONE file: courses, workshops, publications, prizes, '
      + 'volunteering. One upload per certificate is not read as a stronger file, '
      + 'it is read as an unsorted one.'},
  {id:'finance',  name:'Financial documents',   need:1, blocks:'Visa, blocked account'},
  {id:'photo',    name:'Passport photograph (if available)', need:0,
   blocks:'Visa appointment',
   note:'Recent, white background, no glasses. Your counsellor will tell you the '
      + 'exact size your consulate wants before the appointment.'},
  {id:'aps',      name:'APS certificate — Germany (if available)', need:0,
   blocks:'German application — 6–8 weeks, start early'}
];

/* One number, in one place, and it is the SERVER's number.
 *
 * The upload screen refused at 20 MB and the server refused at 10. A student
 * with a 15 MB scan watched the whole upload finish and was then told it was
 * too big — the friendly check let through exactly the files the real one
 * rejects, which is worse than having no friendly check at all. */
const MAX_UPLOAD_MB = 10;
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


# The one reading of a student's grade, for the four screens that compare it
# against a bar written out of ten. Three of them divided by nothing: a student
# marked out of 4 with a 3.6 read as 3.6 and failed every gate on the site,
# and a profile carrying an impossible 47.9 cleared all of them. The maximum
# has been on the profile since the German-grade patch; nothing was reading it.
#
# Mirrors server/grades.js cgpaTen() exactly. Two answers for one student is
# the fault this is fixing, so it must not be re-derived a fifth time.
CGPA_JS = r"""
function cgpaTenOf(p) {
  const raw = Number(String((p || {}).d_cgpa || '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const mx = Number(String((p || {}).d_max || '').replace(/[^0-9.]/g, ''));
  const max = Number.isFinite(mx) && mx > 0 && mx <= 100 ? mx : 10;
  if (raw > max) return null;               /* impossible on their own scale */
  return Math.round(raw / max * 10 * 100) / 100;
}
"""
