"""Scholarships — what you can apply for, checked against the profile you filled in."""

from portal_fields import CGPA_JS

BODY = """
    <div class="p-cols" style="margin-bottom:20px">
      <div class="p-card">
        <h3>Checked against your profile</h3>
        <p style="margin:0 0 12px;font-size:12.8px;color:var(--muted);line-height:1.6"
           id="fitLine">Fill in your profile and this page tells you which of these you actually
          qualify for, rather than listing everything and leaving you to guess.</p>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <span class="pill" id="pCgpa">CGPA —</span>
          <span class="pill" id="pCountry">Destination —</span>
          <span class="pill" id="pLevel">Level —</span>
        </div>
        <a class="btn btn-ghost btn-sm" href="profile.html" style="margin-top:14px">Update my profile</a>
      </div>
      <div class="p-card">
        <h3>Closing soon</h3>
        <div id="soonList"></div>
      </div>
    </div>

    <div class="tabs" style="margin-bottom:16px">
      <button class="tab" role="tab" aria-selected="true" data-f="fit" id="tabFit">Ones you qualify for
        <span class="n" id="nFit">0</span></button>
      <button class="tab" role="tab" aria-selected="false" data-f="all">Open now
        <span class="n" id="nAll">0</span></button>
      <button class="tab" role="tab" aria-selected="false" data-f="saved">Saved
        <span class="n" id="nSaved">0</span></button>
      <button class="tab" role="tab" aria-selected="false" data-f="closed">Closed
        <span class="n" id="nClosed">0</span></button>
    </div>

    <div class="sl-grid" id="schGrid"></div>

    <p style="margin:22px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">Amounts and
      deadlines are what the awarding body published for the current cycle. They change every
      intake — your counsellor confirms each one before you spend time on an application.</p>
"""

SCRIPT = CGPA_JS + r"""
/* Real, well-known awards. Each carries the rule that decides eligibility, so
   the page can say WHY you do or do not qualify instead of just filtering you
   out silently. */
const SCHOLARSHIPS = [
  {id:'daad-epos', name:'DAAD EPOS Development-Related Postgraduate Courses',
   body:'DAAD, Germany', country:'DE', level:'master', cgpa:7.5, work:24,
   amount:'€992/month + travel + insurance', deadline:'2026-10-31',
   note:'Needs at least two years of professional experience. The most generous German award for Indian students.',
   url:'https://www.daad.de/en/studying-in-germany/scholarships/'},
  {id:'daad-study', name:'DAAD Study Scholarship — Master\'s',
   body:'DAAD, Germany', country:'DE', level:'master', cgpa:7.5, work:0,
   amount:'€934/month', deadline:'2026-10-15',
   note:'Awarded on academic record and the strength of your motivation letter.',
   url:'https://www.daad.de/en/studying-in-germany/scholarships/'},
  {id:'deutschland', name:'Deutschlandstipendium',
   body:'German universities', country:'DE', level:'', cgpa:8.0, work:0,
   amount:'€300/month for at least two semesters', deadline:'2026-09-30',
   note:'Applied for through the university once you are enrolled, not before.',
   url:'https://www.deutschlandstipendium.de/'},
  {id:'erasmus', name:'Erasmus Mundus Joint Masters',
   body:'European Commission', country:'', level:'master', cgpa:7.5, work:0,
   amount:'Full tuition + €1,400/month + travel', deadline:'2027-01-15',
   note:'Highly competitive, and you study in two or more countries. Apply to at most three programmes.',
   url:'https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en'},
  {id:'chevening', name:'Chevening Scholarship',
   body:'UK Government', country:'GB', level:'master', cgpa:7.0, work:24,
   amount:'Full tuition + living costs + flights', deadline:'2026-11-05',
   note:'Two years of work experience is a hard requirement, and you must return to India for two years.',
   url:'https://www.chevening.org/'},
  {id:'commonwealth', name:'Commonwealth Master\'s Scholarship',
   body:'CSC, United Kingdom', country:'GB', level:'master', cgpa:7.5, work:0,
   amount:'Full tuition + stipend + flights', deadline:'2026-12-18',
   note:'Nominated through a listed university or an approved nominating body.',
   url:'https://cscuk.fcdo.gov.uk/'},
  {id:'vanier', name:'Ontario / provincial entrance awards',
   body:'Canadian universities', country:'CA', level:'', cgpa:8.0, work:0,
   amount:'CAD 2,000 – 20,000', deadline:'2027-02-01',
   note:'Applied for with your university application — most have no separate form.',
   url:'https://www.educanada.ca/scholarships-bourses/index.aspx'},
  {id:'gov-ireland', name:'Government of Ireland International Education Scholarship',
   body:'Higher Education Authority, Ireland', country:'IE', level:'', cgpa:8.0, work:0,
   amount:'€10,000 + tuition waiver for one year', deadline:'2027-03-26',
   note:'Around 60 awards a year across all nationalities.',
   url:'https://www.hea.ie/'},
  {id:'nbhm', name:'Poland — NAWA Banach Scholarship',
   body:'NAWA, Poland', country:'PL', level:'master', cgpa:7.0, work:0,
   amount:'Tuition waiver + PLN 1,700/month', deadline:'2027-04-30',
   note:'Restricted to selected fields — engineering, science, agriculture.',
   url:'https://nawa.gov.pl/en/'},
  {id:'inlaks', name:'Inlaks Shivdasani Scholarship',
   body:'Inlaks Foundation, India', country:'', level:'master', cgpa:8.0, work:0,
   amount:'Up to USD 100,000', deadline:'2027-03-15',
   note:'Indian citizens only, under 30, with an offer already in hand.',
   url:'https://www.inlaksfoundation.org/'},
  {id:'jnmf', name:'JN Tata Endowment Loan Scholarship',
   body:'JN Tata Endowment, India', country:'', level:'', cgpa:7.0, work:0,
   amount:'₹1–10 Lakhs as a low-interest loan scholarship', deadline:'2027-03-14',
   note:'Open to Indian graduates for any country. Repayable, but at a nominal rate.',
   url:'https://www.jntataendowment.org/'},
  {id:'kfw', name:'Education loan interest subsidy (Padho Pardesh style state schemes)',
   body:'State governments, India', country:'', level:'', cgpa:6.0, work:0,
   amount:'Interest subsidy on your education loan', deadline:'2027-06-30',
   note:'Varies by state and by income ceiling. Your counsellor checks Telangana and AP schemes for you.',
   url:''}
];

DB.saved = DB.saved || [];      /* saved against the account, on the server */
const P = DB.profile || {};
const cgpa = cgpaTenOf(P);
const cmap = {Germany:'DE','United Kingdom':'GB',Canada:'CA',Ireland:'IE',Poland:'PL',Spain:'ES',Italy:'IT'};
/* Several destinations are allowed now, so a scholarship in any of them
   counts. `wantC` stays a single code because the matching below compares one;
   `wantCs` is the list, and the single is the first that maps. */
const wantCs = String(P.g_country || '').split(',').map(x => x.trim())
  .map(x => cmap[x]).filter(Boolean);
const wantC = wantCs[0] || '';
const lvl = (P.g_level || '').toLowerCase().includes('master') ? 'master'
          : (P.g_level || '').toLowerCase().includes('bachelor') ? 'bachelor' : '';
const months = parseInt(P.w_months || '0', 10) || 0;

$('#pCgpa').textContent    = cgpa ? 'CGPA ' + cgpa : 'CGPA — not set';
$('#pCountry').textContent = P.g_country ? 'Destination ' + P.g_country : 'Destination — not set';
$('#pLevel').textContent   = P.g_level ? 'Level ' + P.g_level : 'Level — not set';
/* What is missing, named once, at the top.
 *
 * Every card used to carry the badge "Check with a counsellor" when the profile
 * was empty — twelve identical shrugs — and the tab above them still claimed to
 * show what you qualify for: twelve of twelve. The screen was checking nothing
 * and said so twelve times without once saying why.
 *
 * Say it here, name the fields, and let the cards be about the scholarships. */
const MISSING = [
  [!cgpa, 'your CGPA'],
  [!P.g_country, 'your destination'],
  [!P.g_level, 'whether it is a bachelor\u2019s or a master\u2019s'],
].filter(x => x[0]).map(x => x[1]);

$('#fitLine').textContent = !MISSING.length
  ? 'Matched against a CGPA of ' + cgpa + (P.g_country ? ', ' + P.g_country : '') +
    (months ? ' and ' + months + ' months of work experience' : '') + '.'
  : cgpa
    ? 'Matched on a CGPA of ' + cgpa + '. Add ' + MISSING.join(' and ')
      + ' and this gets sharper.'
    : 'We cannot check these against you yet \u2014 your profile is missing '
      + MISSING.join(', ') + '. It takes two minutes, and this page becomes a '
      + 'list of what you can actually win.';

function verdict(s) {
  if (!cgpa) return {ok: null, why: 'Fill in your CGPA to check this'};
  const miss = [];
  if (cgpa < s.cgpa) miss.push('needs CGPA ' + s.cgpa + '+');
  if (s.work && months < s.work) miss.push('needs ' + (s.work / 12) + ' years of work experience');
  /* Any of the destinations they named, not just the first. A student
     considering Germany and Poland is not disqualified from a Polish award. */
  if (s.country && wantCs.length && wantCs.indexOf(s.country) < 0) miss.push('is for ' +
    ((COUNTRIES[s.country] || {}).name || s.country) + ', not a destination you chose');
  if (s.level && lvl && s.level !== lvl) miss.push('is for ' + s.level + "'s applicants");
  return miss.length ? {ok: false, why: 'Not yet — it ' + miss.join(', and ')}
                     : {ok: true, why: 'You meet the published criteria'};
}
function dleft(s) { return Math.round((new Date(s.deadline) - new Date()) / 86400000); }
/* An award whose deadline has passed is not one you can apply for, whatever
   your CGPA. It stayed in the list, counted in the total, and sat in "ones you
   qualify for" — a scholarship you cannot enter, offered as an opportunity. */
function closed(s) { return dleft(s) < 0; }
function dfmt(s) {
  return new Date(s.deadline).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
}

function card(s) {
  const v = verdict(s);
  const saved = DB.saved.includes(s.id);
  const left = dleft(s);
  const tone = v.ok === true ? 'badge-start' : v.ok === false ? 'badge-value' : 'badge-fast';
  return '<article class="sl">' +
    '<span class="sl-flag">' + ((COUNTRIES[s.country] || {}).flag || '🌍') + '</span>' +
    '<h3>' + esc(s.name) + '</h3>' +
    '<div class="uni">' + esc(s.body) + '</div>' +
    /* No badge at all when there is nothing to judge on. A row of twelve
       identical "check with a counsellor" chips is not information — it is the
       screen apologising, once per card, for a thing it already said at the
       top. */
    (v.ok === null ? ''
      : '<span class="badge ' + tone + '" style="margin:11px 0 9px;width:fit-content">'
        + (v.ok === true ? 'You qualify' : 'Not yet') + '</span>') +
    (closed(s) ? '<span class="badge badge-value" style="margin:11px 0 9px;'
      + 'width:fit-content">Closed for this cycle</span>' : '') +
    '<div class="sl-meta"><b>' + esc(s.amount) + '</b></div>' +
    '<div class="sl-meta" style="color:var(--muted)">Closes ' + dfmt(s) +
      (left > 0 && left < 90 ? ' · ' + left + ' days left' : '') + '</div>' +
    '<p style="margin:9px 0 0;font-size:12.2px;color:var(--muted);line-height:1.55">' +
      (v.ok === null ? '' : esc(v.why) + '. ') + esc(s.note) + '</p>' +
    '<div class="sl-go" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<button type="button" class="btn ' + (saved ? 'btn-green' : 'btn-navy') + ' btn-sm" data-save="' +
        s.id + '">' + (saved ? ico('check') + ' Saved' : 'Save this') + '</button>' +
      (s.url ? '<a class="btn btn-ghost btn-sm" href="' + esc(s.url) +
        '" target="_blank" rel="noopener">Official page</a>' : '') +
      '<a class="btn btn-ghost btn-sm" href="messages.html">Ask my counsellor</a>' +
    '</div></article>';
}

/* With nothing to check against, "ones you qualify for" is a claim the screen
   cannot make. It opened on that tab and showed all twelve — the same twelve as
   "All scholarships", with the same count beside both, which is how you can
   tell a filter is not filtering. Open on what is genuinely open instead, and
   hide the tab until the profile can answer it. */
let filt = MISSING.length ? 'all' : 'fit';

function paint() {
  const open = SCHOLARSHIPS.filter(s => !closed(s));
  /* Strictly ok === true. `!== false` counted every unknown as a pass, which is
     exactly how twelve unknowns became twelve you qualify for. */
  const fit = open.filter(s => verdict(s).ok === true);
  const shut = SCHOLARSHIPS.filter(closed);

  const tabFit = $('#tabFit');
  if (tabFit) tabFit.hidden = MISSING.length > 0;
  /* Every tab, not just the one being hidden. The markup ships with "fit"
     selected, so when the profile is empty and we open on "all" instead, the
     chip that is lit is the one that is not there. */
  $$('.tab[data-f]').forEach(x =>
    x.setAttribute('aria-selected', String(x.dataset.f === filt)));
  $('#nFit').textContent    = fit.length;
  $('#nAll').textContent    = open.length;
  $('#nSaved').textContent  = DB.saved.length;
  $('#nClosed').textContent = shut.length;

  const list = filt === 'all' ? open
             : filt === 'saved' ? SCHOLARSHIPS.filter(s => DB.saved.includes(s.id))
             : filt === 'closed' ? shut
             : fit;
  $('#schGrid').innerHTML = list.map(card).join('') || (
    filt === 'saved'
      ? '<div class="sl-empty"><b>Nothing saved yet</b><p>Save a scholarship and it '
        + 'appears here, and your counsellor sees it too.</p></div>'
      : filt === 'fit'
        ? '<div class="sl-empty"><b>None of these fit your profile yet</b>'
          + '<p>That is worth a conversation rather than a shrug — several of them turn '
          + 'on work experience or a test score you can still get.</p>'
          + '<a class="btn btn-primary" href="messages.html">Ask my counsellor</a></div>'
        : '<div class="sl-empty"><b>Nothing open right now</b><p>Deadlines reopen each '
          + 'cycle. Your counsellor watches them for you.</p></div>');
  const soon = open.sort((a, b) => dleft(a) - dleft(b)).slice(0, 5);
  $('#soonList').innerHTML = soon.map(s =>
    '<div class="deadline"><span>' + esc(s.name.length > 42 ? s.name.slice(0, 40) + '…' : s.name) +
    '</span><span class="d">' + dleft(s) + ' days</span></div>').join('');
  save();
}

document.addEventListener('click', e => {
  const t = e.target.closest('.tab[data-f]');
  if (t) {
    $$('.tab[data-f]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
    filt = t.dataset.f; paint(); return;
  }
  const s = e.target.closest('[data-save]');
  if (s) {
    const id = s.dataset.save;
    DB.saved = DB.saved.includes(id) ? DB.saved.filter(x => x !== id) : DB.saved.concat(id);
    paint();
    toast(DB.saved.includes(id) ? 'Saved to your list.' : 'Removed from your list.');
  }
});

paint();
"""
