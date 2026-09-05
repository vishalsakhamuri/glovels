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

/* Answers that mean "there is no scorecard", so nothing about a score should
   be asked. "Not taken yet" was missing from this list entirely — a student who
   had simply not sat one had to claim it was not required. */
const NOAPT = v => !v || /not required|not taken|planning/i.test(String(v || ''));

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
    /* FIVE, prefilled, and that is a change of mind worth writing down.
     *
     * This shipped with no default at all, on the argument that the pass mark
     * decides the German grade — the same 6.84 is 2.5 where the pass mark is 4
     * and 2.8 where it is 5 — so a wrong default is a wrong grade.
     *
     * That was right about the arithmetic and wrong about people. Almost
     * nobody knows their pass mark off the top of their head, so the box sat
     * empty, and an empty box does not produce a careful answer: it produces
     * NO German grade at all, which is worse than a stated assumption a
     * student can correct. The counsellors asked for 5 because 5 is what most
     * of the Indian universities they see actually use.
     *
     * So it is prefilled and it SAYS it is prefilled. A student who checks
     * their regulations and finds 4 changes one character. */
    {k:'d_pass',   l:'Minimum passing grade at your university', t:'text', ph:'5',
     def:'5',
     help:'We have filled in 5, which is the commonest. It differs at every '
        + 'university \u2014 it is in your academic regulations and printed on '
        + 'many transcripts. Check it: it moves your German grade.'},
    /* Total, not active.
     *
     * A university form asks how many subjects were ever failed, not how many
     * are outstanding today — a student who cleared all six last term answers
     * "None" to "active backlogs" and the form they eventually sign says
     * something different from what they told us. */
    /* A NUMBER, because a university form asks for a number.
     *
     * This offered "1-2", "3-5" and "More than 5", and every one of those has
     * to be turned back into a figure by whoever fills the actual application
     * — from a range that cannot be. A student with four backlogs picked "3-5"
     * and the form still needed to say 4.
     *
     * An answer already given is kept: the select appends a stored value that
     * is no longer on the list rather than silently blanking it. */
    {k:'d_backlog',l:'Total backlogs (including cleared)', t:'select',
     o:['','0','1','2','3','4','5','6','7','8','9','10','More than 10'],
     help:'Every subject you have ever failed, even if you passed it later. '
        + 'A university asks for the total; declaring it is never the problem, '
        + 'a mismatch later is.'}
  ]},
  /* A MASTER'S, for the people who have one.
   *
   * "Add master's details for people with master's degree."
   *
   * Two kinds of student were being asked the wrong questions. Somebody with a
   * master's applying for a second one, or for a PhD, had nowhere to put it —
   * so their strongest qualification was absent from a record built to argue
   * their case, and a counsellor found out about it on a call.
   *
   * The whole section is OPTIONAL and hangs off the first question. A student
   * who answers No sees nothing else, so the form is not longer for the great
   * majority who have only a bachelor.
   *
   * DELIBERATELY NOT READ BY THE MATCHER. German master's admission is decided
   * on the bachelor — that is what the Bavarian formula converts and what every
   * bar in the catalogue is written against — so adding a second grade to that
   * comparison would change who qualifies for what on the strength of a field
   * nobody has checked. It is here to be read by a person. */
  {id:'masters', icon:'i-cap', name:'Master\u2019s degree', fields:[
    {k:'m_has',    l:'Do you have a master\u2019s degree?', t:'select',
     o:['','No','Yes','In progress'],
     help:'Leave this as No if your highest degree is a bachelor.'},
    {k:'m_uni',    l:'University', t:'text', ph:'University of Hyderabad',
     show:p=>/^(yes|in progress)$/i.test(p.m_has||'')},
    {k:'m_course', l:'Course', t:'text', ph:'M.Tech Computer Science',
     show:p=>/^(yes|in progress)$/i.test(p.m_has||'')},
    {k:'m_start',  l:'Year of joining', t:'select', years:[40, 0],
     show:p=>/^(yes|in progress)$/i.test(p.m_has||'')},
    {k:'m_year',   l:'Year of completion', t:'select', years:[40, 3],
     show:p=>/^(yes|in progress)$/i.test(p.m_has||'')},
    {k:'m_cgpa',   l:'Your overall grade', t:'text', ph:'8.1',
     show:p=>/^yes$/i.test(p.m_has||''),
     help:'Whatever your transcript prints. The two boxes below say what scale.'},
    {k:'m_max',    l:'Maximum grade at that university', t:'text', ph:'10',
     show:p=>/^yes$/i.test(p.m_has||'')},
    {k:'m_pass',   l:'Minimum passing grade at that university', t:'text', ph:'5',
     show:p=>/^yes$/i.test(p.m_has||'')},
    {k:'m_backlog',l:'Total backlogs (including cleared)', t:'select',
     o:['','0','1','2','3','4','5','6','7','8','9','10','More than 10'],
     show:p=>/^yes$/i.test(p.m_has||'')}
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
    /* Home or centre, for the one test where it changes what a university
       will take. TOEFL iBT Home Edition is not accepted everywhere, and a
       counsellor who finds that out at submission has lost the intake. Only
       shown for TOEFL, because only TOEFL asks it. */
    {k:'e_mode',  l:'Where you sat it', t:'select', grp:'e1',
     o:['','At a test centre','At home (Home Edition)'],
     show:p=>/toefl/i.test(String(p.e_test||'')),
     help:'Some universities do not accept the at-home version. Worth knowing '
        + 'before we file rather than after.'},
    /* A Medium of Instruction letter is issued BY somewhere, and which
       somewhere decides whether it is accepted: a letter from the college is
       refused where the university's own is taken. Asked only when MOI is the
       answer. */
    {k:'e_moi_from', l:'Who issued the letter', t:'select', grp:'e1',
     o:['','My bachelor\u2019s college','My bachelor\u2019s university'],
     show:p=>/medium of instruction/i.test(String(p.e_test||'')),
     help:'Many universities accept only one issued by the university itself, '
        + 'not the affiliated college.'},
    {k:'e_score', l:'Overall score', t:'text', ph:'7.0', grp:'e1',
     show:p=>!/^(not taken yet)$/i.test(String(p.e_test||'')),
     opt:p=>/^medium of instruction letter$/i.test(String(p.e_test||''))},
    {k:'e_date',  l:'Test date', t:'date3', back:6, ahead:2, grp:'e1',
     show:p=>!/^not taken yet$/i.test(String(p.e_test||''))},
    /* The bands are HIDDEN, not merely optional, for a test that does not have
       them. Asking somebody who has not sat a test — or who is filing a Medium
       of Instruction letter — for their Listening score is noise on a form
       that is already long, and it was being asked. */
    {k:'e_low',   l:'Lowest band', t:'text', ph:'6.5', grp:'e1',
     show:p=>BANDED(p),
     help:'Most German and UK programmes require no band below 6.0.'},
    /* Per skill, because a university asks per skill. A 7.0 overall with a 5.5
       in writing is refused by programmes a 6.5 flat would pass. */
    {k:'e_listen', l:'Listening', t:'text', ph:'7.0', grp:'e1', show:p=>BANDED(p)},
    {k:'e_read',   l:'Reading',   t:'text', ph:'7.5', grp:'e1', show:p=>BANDED(p)},
    {k:'e_write',  l:'Writing',   t:'text', ph:'6.5', grp:'e1', show:p=>BANDED(p)},
    {k:'e_speak',  l:'Speaking',  t:'text', ph:'7.0', grp:'e1', show:p=>BANDED(p)},
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
    /* "Not taken yet" is a different answer from "Not required" and from
       "Planning to take", and a student who has simply not sat one had to pick
       something untrue. It leads, because it is the commonest. */
    {k:'a_test',  l:'Test', t:'select', grp:'a1',
     o:['','Not taken yet','Not required','GRE','GMAT','GATE','SAT','ACT','NEET',
        'Planning to take']},
    {k:'a_score', l:'Overall score', t:'text', ph:'318', grp:'a1',
     show:p=>!NOAPT(p.a_test)},
    {k:'a_date',  l:'Test date', t:'date3', back:6, ahead:2, grp:'a1',
     show:p=>!NOAPT(p.a_test)},
    /* Where it was sat. Same reason as TOEFL: the at-home version of the GRE
       is not taken everywhere, and finding that out at submission costs the
       intake. */
    {k:'a_mode',  l:'Where you sat it', t:'select', grp:'a1',
     o:['','At a test centre','At home'],
     show:p=>/^(gre|gmat)$/i.test(String(p.a_test||''))},
    /* THE GRE IS THREE SCORES, NOT ONE.
     *
     * "GRE — add additional fields — Quantitative Reasoning Score, Verbal
     * Reasoning Score, Analytical Writing Analysis — Score and Percentile."
     *
     * A single 318 is the sum of two of the three, and it is not what a
     * programme asks for: a Master's in engineering reads the quant score and
     * a taught Master's in the humanities reads the verbal one. The percentile
     * matters as much as the score — 160 quant is a different applicant from
     * 160 verbal, and only the percentile says so.
     *
     * All optional. A student who knows their overall and has to go and find
     * the breakdown should not be blocked from saving. */
    {k:'a_q',     l:'Quantitative Reasoning \u2014 score', t:'text', ph:'165', grp:'a1',
     show:p=>/^gre$/i.test(String(p.a_test||'')), opt:()=>true},
    {k:'a_q_pc',  l:'Quantitative Reasoning \u2014 percentile', t:'text', ph:'88', grp:'a1',
     show:p=>/^gre$/i.test(String(p.a_test||'')), opt:()=>true},
    {k:'a_v',     l:'Verbal Reasoning \u2014 score', t:'text', ph:'153', grp:'a1',
     show:p=>/^gre$/i.test(String(p.a_test||'')), opt:()=>true},
    {k:'a_v_pc',  l:'Verbal Reasoning \u2014 percentile', t:'text', ph:'58', grp:'a1',
     show:p=>/^gre$/i.test(String(p.a_test||'')), opt:()=>true},
    {k:'a_aw',    l:'Analytical Writing \u2014 score', t:'text', ph:'4.0', grp:'a1',
     show:p=>/^gre$/i.test(String(p.a_test||'')), opt:()=>true},
    {k:'a_aw_pc', l:'Analytical Writing \u2014 percentile', t:'text', ph:'54', grp:'a1',
     show:p=>/^gre$/i.test(String(p.a_test||'')), opt:()=>true},
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

/* And the TYPES, in one place, for exactly the same reason.
 *
 * The picker carried an accept list and the card advertised "PDF, JPG, PNG or
 * Word", and the server checked neither — so a .txt went into the Class 12
 * slot and an .html into the CV slot and both sat there looking like
 * documents. `accept` filters a dialog; every browser lets somebody switch it
 * to All Files. The rule is on the server now and these three lines are what
 * the student is shown, built from the same list so they cannot drift apart.
 *
 * HEIC is on it. This card tells a student to photograph the pages when a scan
 * is too big, and an iPhone photographing pages produces HEIC. */
const UPLOAD_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'doc', 'docx'];
const UPLOAD_ACCEPT = UPLOAD_EXT.map(e => '.' + e).join(',');
const UPLOAD_SAYS = 'PDF, a photo (JPG, PNG or HEIC) or Word';
const notOurType = name => {
  const ext = String(name || '').toLowerCase().split('.').pop();
  return UPLOAD_EXT.includes(ext) ? null
    : 'Glovels takes ' + UPLOAD_SAYS + '. “' + String(name || 'That file').slice(0, 60)
      + '” is not one of those — open it, and save or export it as a PDF.';
};
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
   blocks:'Pre-departure briefing and city registration'},
  /* THE LAST TWO DOCUMENTS IN THE WHOLE JOURNEY, and there was nowhere to put
     either. "Enrolment docs are missing in this succession. Tuition fee or
     semester fee invoice. Document option for enrolment certificate."
     They come after the visa, which is why they belong on this screen rather
     than with the application papers: a student who has landed still has two
     things to send us, and the file was ending at the plane ticket. */
  {id:'fee-invoice',     name:'Tuition or semester fee invoice', need:0,
   blocks:'Enrolment. Some universities want it paid before they register you',
   note:'The invoice the university sends for the semester contribution or '
      + 'tuition. Send the invoice itself, not the bank receipt.'},
  {id:'enrolment',       name:'Enrolment certificate',       need:0,
   blocks:'City registration, a bank account, a student travel pass',
   note:'The Immatrikulationsbescheinigung, or whatever your university calls '
      + 'it. It is the proof you are a student and half of Germany asks for it.'}
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


# German grades, for the screens inside the account.
#
# THE FUNCTION ITSELF IS NOT NEW. It has been in index.html since the German
# grade patch, injected by apply_fixes.py, and everything it is and why it
# truncates rather than rounds is written above GRADE_JS there.
#
# What is new is that the portal needs it. The programme cards now state the
# German grade a course asks for — "add German grade requirement on the cards"
# — and a bar stated without saying whether this student meets it is half a
# sentence. The CGPA line two rows above it has said "above yours" for months.
#
# DEFINED ONCE, in the file the portal already imports from, and imported by
# apply_fixes.py for index.html. Two copies of a conversion formula is the
# exact shape of the stages and the outcomes, which were four copies and
# agreed until they did not — and this one is worse, because two copies of a
# formula do not look different when they disagree. They just give a student
# 2.5 on one screen and 2.6 on the next.
GERMAN_JS = r"""
/* Their own German grade, off the profile they filled in. Null when we cannot
   know — a missing pass mark is not a reason to guess. `d_pass` defaults to 5
   on the form, so this is answerable for anybody who has entered a CGPA. */
function myGerman(p) {
  const o = Number(String((p || {}).d_cgpa || '').replace(/[^0-9.]/g, ''));
  const mx = Number(String((p || {}).d_max || '').replace(/[^0-9.]/g, ''));
  const max = Number.isFinite(mx) && mx > 0 && mx <= 100 ? mx : 10;
  const pass = Number(String((p || {}).d_pass || '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(pass)) return null;
  if (max <= pass || o < pass || o > max) return null;
  const g = 1 + 3 * (max - o) / (max - pass);
  /* Truncated, not rounded, and clamped to the ends of the scale. Both
     decisions are argued where this formula was first written; the short of it
     is that every tool a counsellor will check us against truncates, and 0.1
     is the difference between meeting a 2.5 bar and missing it. */
  return Math.floor(Math.max(1, Math.min(4, g)) * 10) / 10;
}

/* THE SCALE RUNS BACKWARDS and that is the whole trap in this feature.
   1.0 is the best grade there is and 4.0 is the pass, so a student MEETS a
   requirement of 2.5 by having 2.5 or LESS. Writing this as a named function
   rather than an inline `<=` is deliberate: every reader of `mine <= bar` has
   to stop and remember which way round it goes, and one of them eventually
   will not. */
const meetsGerman = (mine, bar) =>
  (mine == null || bar == null) ? true : mine <= bar;
"""


# Where an application has got to, and what came back — the same two lists the
# server keeps in server/apps.js, for the four screens that draw them.
#
# They were four separate copies. portal_counsellor.py even carried the comment
# "kept here as the same list rather than a second one, because two lists that
# must agree eventually will not" directly above the second one. Renaming a
# stage meant finding five places, and the counsellor's screen and the
# student's would have disagreed about the same application in the meantime.
#
# Mirrors server/apps.js. `said` is not mirrored — the sentence a student reads
# is written on the server, where the message is sent, and a browser has no
# business composing it.
APPS_JS = r"""
const STAGES = [
  {k:'docs',   n:'Documents collected', d:'Everything the university asks for, verified and in order.'},
  {k:'draft',  n:'Application drafted', d:'Forms filled, SOP and LORs attached, checked line by line.'},
  {k:'sent',   n:'Submitted',           d:'Filed with the university, reference number on record.'},
  {k:'review', n:'Under review by university',
   d:'With the admissions committee. We follow up on a schedule.'},
  {k:'decided',n:'Decision',            d:'Offer, rejection or a request for more information.'}
];

const OUTCOMES = [
  {k:'',            n:'No decision yet', tone:'',     open:true},
  {k:'offer',       n:'Offer',           tone:'ok',   open:false},
  {k:'waitlist',    n:'Waitlisted',      tone:'wait', open:true,
   d:'Admission is not possible at the moment. The place may still come.'},
  {k:'deferred',    n:'Deferred',        tone:'wait', open:true,
   d:'Held over to a later intake.'},
  {k:'rejected',    n:'Rejected',        tone:'bad',  open:false},
  {k:'relinquished',n:'Relinquished',    tone:'',     open:false,
   d:'An offer came and was not accepted.'},
  {k:'enrolled',    n:'Enrolled',        tone:'ok',   open:false,
   d:'Accepted, and enrolled.'}
];

const outcomeOf = k => OUTCOMES.find(o => o.k === String(k || '')) || OUTCOMES[0];
/* An offer arrived at some point. Enrolled and relinquished both had one, and
   counting only 'offer' understates the year every time somebody records what
   actually happened next. */
const hadOffer = k => ['offer', 'enrolled', 'relinquished'].includes(String(k || ''));
"""
