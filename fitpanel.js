/*
 * FIND WHAT FITS — the finder's filters, for staff, with the names (patch 147).
 *
 * "We hide the university shortlist until paid by student, so we need these
 *  proper filters to work in the counsellor and admin panel so that
 *  shortlisting of the unis can be tested."
 *
 * One panel, two screens:
 *   counsellor  starts from the open student's profile; Add puts a programme
 *               on their list.
 *   catalogue   (admin) a profile typed in by hand — to test what a package
 *               would deliver without a student, a payment or a shortlist.
 *
 * Every answer comes from the server's matcher (server/matches.js screen and
 * plan), the same code that delivers the paid shortlist — so what passes here
 * is exactly what a student would be given, and every "no" says why.
 *
 *   GlovelsFit.mount(element, {
 *     profile,                 // the starting answers (the student's profile)
 *     run(filters) -> Promise, // the server's answer for these filters
 *     onAdd(id) -> Promise,    // optional: put one on the student's list
 *     note                     // optional: a line above the form
 *   })
 */
(function () {
  'use strict';
  /* The same field names the home page's dropdown offers (patch 153 added the
   * seventeen engineering, health, science and business ones), kept
   * alphabetical so a counsellor finds them where they expect. */
  /* Countries the matcher offers. Starts with the ones we sell and grows to
     whatever the catalogue holds once /api/staff/catalogue answers. */
  let COUNTRIES = ['Germany', 'United Kingdom', 'Ireland', 'Canada', 'Italy', 'Poland', 'Spain', 'France', 'Netherlands', 'United States', 'Australia', 'New Zealand'];
  let countriesLoaded = false;
  function loadCountries() {
    if (countriesLoaded) return Promise.resolve(COUNTRIES);
    return fetch('/api/staff/catalogue?per=1', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        const names = ((j && j.countries) || []).filter(c => c && c.name && c.active !== false).map(c => c.name);
        if (names.length) { COUNTRIES = names; countriesLoaded = true; }
        return COUNTRIES;
      }).catch(() => COUNTRIES);
  }
  /* The profile's destination, if it is one country we list; a profile that
     says "Germany, Canada" or "Open to advice" starts on Any country. */
  function countryPick(v) {
    const parts = String(v || '').split(',').map(x => x.trim()).filter(Boolean);
    if (parts.length !== 1) return '';
    const hit = COUNTRIES.find(c => c.toLowerCase() === parts[0].toLowerCase());
    return hit || '';
  }
  const FIELDS = ['Aerospace & Robotics', 'Agriculture & Food Science', 'Animation, Film & Game Design',
    'Architecture, Urban Planning & Built Environment', 'Arts & Design', 'Biomedical Engineering',
    'Biotechnology & Bioinformatics', 'Business & Management', 'Chemical & Process Engineering',
    'Civil & Construction Engineering', 'Computer Science & IT', 'Cybersecurity & Cloud',
    'Data Science, AI & Machine Learning', 'Earth Sciences & Geology', 'Economics', 'Education & Teaching',
    'Electrical & Electronics Engineering', 'Environmental Science & Sustainability', 'Fashion & Luxury Management',
    'Finance, Banking & Accounting', 'Hospitality, Tourism & Events', 'Humanities & Languages',
    'Industrial & Manufacturing Engineering', 'International Relations & Public Policy', 'Law & Legal Studies',
    'MBA', 'Marine & Naval Engineering', 'Marketing & Digital Media', 'Materials Science & Engineering',
    'Mathematics, Statistics & Actuarial Science', 'Mechanical & Automotive Engineering', 'Mechatronics, Robotics & Automation',
    'Media & Communication', 'Medicine, Dentistry & Allied Health', 'Mining, Petroleum & Energy Engineering',
    'Natural Sciences (Physics, Chemistry, Maths)', 'Nursing & Allied Health Sciences', 'Pharmacy & Pharmaceutical Sciences',
    'Psychology', 'Public Health & Healthcare Management', 'Real Estate & Property Management', 'Renewable Energy',
    'Social Sciences & Social Work', 'Sport & Exercise Science', 'Supply Chain, Logistics & Operations',
    'Veterinary & Animal Sciences'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lakh = n => n ? '₹' + (n / 100000).toFixed(n % 100000 ? 1 : 0) + 'L' : '₹0 tuition';

  /* ------------------------------------------------------------ the logos */

  /* The university's logo beside its name, from /logos/index.json — the
     same index and the same simplified matcher the finder page uses
     (server/find.js logoFor; the full one is server/logos.js). The rows the
     matcher API returns carry no `logo`, so it is worked out here; the
     index is fetched once, and until it has arrived the list is drawn
     without logos and redrawn when it lands. Keep the normalisation in step
     with the server's. */
  const LOGO_STOP = { university: 1, universitat: 1, univ: 1, uni: 1, of: 1, the: 1, and: 1, for: 1, in: 1, at: 1, applied: 1, sciences: 1, science: 1, arts: 1,
    hochschule: 1, fachhochschule: 1, fh: 1, hs: 1, uas: 1, fur: 1, und: 1, der: 1, die: 1, des: 1, college: 1, school: 1, campus: 1, gmbh: 1, ag: 1, ev: 1, e: 1, v: 1 };
  const LOGO_TECH = { technische: 1, technology: 1, technical: 1, tu: 1, th: 1 };
  const LOGO_CITY = { munich: 'munchen', nuremberg: 'nurnberg', cologne: 'koln', hanover: 'hannover', brunswick: 'braunschweig', berliner: 'berlin', frankfurter: 'frankfurt', hamburger: 'hamburg' };
  function logoTokens(name) {
    let t = String(name || '').toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
    t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ');
    t = t.replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a');
    return t.split(' ').map(w => LOGO_TECH[w] ? 'tech' : (LOGO_CITY[w] || w)).filter(w => w && !LOGO_STOP[w]);
  }
  let logoIdx = null, logoFetch = null;
  function buildLogoIndex(src) {
    const exact = {}, norm = {}, entries = [];
    const put = (name, file) => {
      if (!file || !name) return;
      if (!exact[name]) exact[name] = file;
      const toks = logoTokens(name);
      if (!toks.length) return;
      const k = toks.join(' ');
      if (!norm[k]) norm[k] = file;
      entries.push({ file, toks });
    };
    Object.keys(src.files || {}).forEach(n => put(n, src.files[n]));
    Object.keys(src.aliases || {}).forEach(f => (src.aliases[f] || []).forEach(a => put(a, f)));
    return { exact, norm, entries, cache: {} };
  }
  /* Resolves once the index is here; the caller redraws then. */
  function loadLogos() {
    if (logoFetch) return logoFetch;
    logoFetch = (typeof fetch === 'function' ? fetch('/logos/index.json', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null) : Promise.resolve(null))
      .then(j => { if (j && typeof j === 'object') logoIdx = buildLogoIndex(j); return logoIdx; })
      .catch(() => null);
    return logoFetch;
  }
  function logoFile(L, name) {
    const n = String(name || '').trim();
    if (!n) return '';
    if (L.exact[n]) return L.exact[n];
    const toks = logoTokens(n);
    if (!toks.length) return '';
    const k = toks.join(' ');
    if (L.norm[k]) return L.norm[k];
    let best = null, bestScore = 0, tie = false;
    L.entries.forEach(e => {
      let both = 0;
      toks.forEach(t => { if (e.toks.indexOf(t) >= 0) both++; });
      const sc = both / (toks.length + e.toks.length - both);
      if (sc > bestScore) { best = e; bestScore = sc; tie = false; }
      else if (sc === bestScore && best && e.file !== best.file) tie = true;
    });
    return best && bestScore >= 0.6 && !tie ? best.file : '';
  }
  /** '/logos/<file>' or '' — '' too until the index has loaded. */
  function logoFor(name, shortName) {
    const L = logoIdx;
    if (!L) return '';
    const ck = String(name || '') + '\u0000' + String(shortName || '');
    if (L.cache[ck] !== undefined) return L.cache[ck];
    const n = String(name || '');
    const paren = /^([^()]+)\(([^()]+)\)\s*$/.exec(n);
    const f = logoFile(L, n) || (paren ? logoFile(L, paren[1]) || logoFile(L, paren[2]) : '') || logoFile(L, shortName);
    return (L.cache[ck] = f ? '/logos/' + encodeURIComponent(f) : '');
  }
  const logoTile = r => {
    const src = r.logo || logoFor(r.university, r.shortName);
    return src ? '<img class="ulogo" src="' + esc(src) + '" alt="" width="28" height="28" loading="lazy" decoding="async">' : '';
  };

  /* This semester, next semester and the two after — the terms the finder offers. */
  function terms() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const out = [];
    for (let y = t.getFullYear(); out.length < 4; y++) {
      [['Summer', 3], ['Winter', 9]].forEach(([s, m]) => {
        if (out.length < 4 && new Date(y, m, 1) > t) out.push(s + ' ' + y);
      });
    }
    return out;
  }
  const dateSaid = s => { const d = new Date(String(s || '') + 'T00:00:00'); return isNaN(d) ? String(s || '') : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  function nextDeadline(intakes, intakeText) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const m = /(summer|winter)\D{0,3}(\d{4})/i.exec(String(intakeText || ''));
    const list = (intakes || []).filter(i => i && i.deadline).map(i => {
      const d = new Date(i.deadline); if (isNaN(d)) return null;
      let at;
      if (m) {
        const se = /summer|spring/i.test(String(i.season || '')) ? 'summer' : 'winter';
        if (se !== m[1].toLowerCase()) return null;
        const y = Number(m[2]), start = new Date(y, se === 'summer' ? 3 : 9, 1);
        const limit = new Date(start); limit.setMonth(limit.getMonth() + 1);
        at = new Date(y, d.getMonth(), d.getDate());
        while (at > limit) at.setFullYear(at.getFullYear() - 1);
      } else {
        at = new Date(today.getFullYear(), d.getMonth(), d.getDate());
        if (at < today) at.setFullYear(at.getFullYear() + 1);
      }
      return at >= today ? at : null;
    }).filter(Boolean).sort((a, b) => a - b);
    return list[0] ? list[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  const CSS = '.gf{font:400 13px/1.45 var(--sans,system-ui)}.gf .gf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 10px}'
    + '.gf label{display:block;font:700 10.5px/1.3 var(--sans,system-ui);text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#5d6b7a);margin-bottom:3px}'
    + '.gf input,.gf select{width:100%;padding:7px 9px;font:400 12.6px/1.3 var(--sans,system-ui);border:1.5px solid #d8dde4;border-radius:8px;background:#fff;box-sizing:border-box}'
    + '.gf .gf-row{display:flex;gap:6px}.gf .gf-row>*{flex:1;min-width:0}'
    + '.gf h4{margin:16px 0 6px;font-size:13.4px}.gf ul{list-style:none;margin:0;padding:0}'
    + '.gf li{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line,#e6e9ee);content-visibility:auto;contain-intrinsic-size:auto 86px}'
    + '.gf li .m{flex:1;min-width:0}.gf li b{display:block;font-size:13px}.gf small{display:block;color:var(--muted,#5d6b7a);font-size:11.8px}'
    + '.gf .why{color:#b42318;font-weight:600}.gf .soft{color:#8a6a1f;font-weight:600}.gf .ask{color:#8a6a1f}.gf .tag{display:inline-block;font:700 10.5px/1.5 var(--sans,system-ui);padding:0 7px;border-radius:999px;background:#eef2f6;margin-right:4px}'
    + '.gf .auto{background:#f5f8fb;border:1px solid var(--line,#e6e9ee);border-radius:10px;padding:10px 12px;margin-top:12px}'
    + '.gf .sum{margin-top:10px;color:var(--muted,#5d6b7a);font-size:12.2px}'
    /* Round 175: off-screen labels for the second and third box of a row,
       and the red word under a box the server refused. */
    + '.gf label.gf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0}'
    + '.gf .gf-row{position:relative}.gf input[aria-invalid="true"],.gf select[aria-invalid="true"]{border-color:#b42318;background:#fff5f4}'
    + '.gf .gf-err{display:block;color:#b42318;font:600 11px/1.3 var(--sans,system-ui);margin-top:3px}'
    + '.gf li .m b{display:flex;align-items:center;gap:8px}'
    + '.gf li .rk{flex:none;min-width:2.4em;padding-top:5px;font:700 11.5px/1.3 var(--sans,system-ui);color:var(--muted,#5d6b7a);font-variant-numeric:tabular-nums}'
    + '.gf .ulogo{width:28px;height:28px;flex:none;object-fit:contain;background:#fff;border:1px solid var(--line,#e6e9ee);border-radius:6px;padding:2px;box-sizing:border-box}'
    /* 10 Oct: the tags box — suggestions under it, chips beside it, and the
       first few of each row's tags in muted pills. */
    + '.gf .gf-tags{position:relative;grid-column:1/-1}.gf .gf-sug{position:absolute;left:0;right:0;top:100%;z-index:30;background:#fff;border:1px solid #d8dde4;border-radius:10px;box-shadow:0 10px 30px rgba(11,30,49,.16);max-height:240px;overflow-y:auto;padding:4px}'
    + '.gf .gf-sug h6{margin:6px 10px 2px;font:700 10.5px/1.3 var(--sans,system-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5d6b7a)}'
    + '.gf .gf-sug button{display:flex;width:100%;justify-content:space-between;gap:10px;padding:7px 10px;border:0;border-radius:8px;background:none;text-align:left;font:600 12.6px/1.35 var(--sans,system-ui);color:inherit;cursor:pointer}'
    + '.gf .gf-sug button:hover,.gf .gf-sug button[aria-selected="true"]{background:#f0f5fb}.gf .gf-sug button em{font:400 11px/1.3 var(--sans,system-ui);color:var(--muted,#5d6b7a);font-style:normal}'
    + '.gf .gf-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.gf .gf-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:99px;border:1px solid #b9cdf0;background:#eef3fc;color:#0b3d91;font:600 11.8px/1.3 var(--sans,system-ui);cursor:pointer}'
    + '.gf .gf-chip small{font-weight:400;opacity:.7}.gf .tagpill{display:inline-block;font:600 10.2px/1.5 var(--sans,system-ui);padding:0 6px;border-radius:999px;background:#f3f5f8;color:#5d6b7a;margin:2px 3px 0 0}';

  function mount(el, o) {
    if (!el) return;
    loadLogos();   /* so it is there by the time the first list is drawn */
    if (!document.getElementById('gf-css')) {
      const st = document.createElement('style'); st.id = 'gf-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const P = Object.assign({}, o.profile || {});
    const sel = (id, opts, val) => '<select id="' + id + '">' + opts.map(([v, t]) =>
      '<option value="' + esc(v) + '"' + (String(v) === String(val || '') ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
    /* Round 175: a profile with no level starts on "Not set", not on
       Master's — the panel used to pick Master's for an empty file silently
       and count 2,707 programmes as a fit for nobody in particular. */
    const lv = /mba/i.test(P.g_level || '') ? "MBA" : /bachelor/i.test(P.g_level || '') ? "Bachelor's" : /found|pathway/i.test(P.g_level || '') ? 'Foundation'
      : /diploma/i.test(P.g_level || '') ? 'Diploma' : /phd|doctor/i.test(P.g_level || '') ? 'PhD'
      : /master/i.test(P.g_level || '') ? "Master's" : '';
    /* Round 175 (item 6): whether they hold a Medium of Instruction letter —
       the English answer says so when the letter IS their English answer;
       this box says so beside a test score (IELTS 6 with a letter in hand). */
    const moi = /medium of instruction|^moi/i.test(P.e_test || '') || /medium of instruction|^moi/i.test(P.e2_test || '') || /^yes/i.test(P.d_moi || '') ? 'yes' : /^no/i.test(P.d_moi || '') ? 'no' : '';
    const eng = /toefl/i.test(P.e_test || '') ? 'TOEFL' : /ielts/i.test(P.e_test || '') ? 'IELTS' : /medium of instruction|^moi/i.test(P.e_test || '') ? 'Medium of Instruction letter' : /not taken/i.test(P.e_test || '') ? 'Not taken yet' : '';
    const gre = /^gre$/i.test(P.a_test || '') ? 'GRE' : /^(not taken|not taken yet|not required)$/i.test(P.a_test || '') ? 'Not taken yet' : '';
    const intake = terms().find(t => t.toLowerCase() === String(P.g_intake || '').toLowerCase()) || '';
    el.innerHTML = '<div class="gf">'
      + (o.note ? '<p style="margin:0 0 10px;color:var(--muted,#5d6b7a);font-size:12.4px">' + o.note + '</p>' : '')
      + '<div class="gf-grid">'
      /* 23 Oct: a dropdown of every country in the catalogue, with "Any
         country" first. The old datalist box was pre-filled with Germany,
         and a datalist only suggests names that start with what is typed —
         so the counsellor saw one option and thought Germany was all we
         had. Filled in from the catalogue once it loads (loadCountries). */
      + '<div><label>Destination</label>' + sel('gfCountry', [['', 'Any country']].concat(COUNTRIES.map(c => [c, c])), countryPick(P.g_country)) + '</div>'
      /* Round 175 (item 6c): every level the catalogue holds (api.js
         normLevel: master, mba, bachelor, foundation, diploma, phd). */
      + '<div><label>Level</label>' + sel('gfLevel', [['', 'Not set'], ["Master's", "Master's"], ['MBA', 'MBA'], ["Bachelor's", "Bachelor's"], ['Foundation', 'Foundation / Pathway'], ['Diploma', 'Diploma / PG Diploma'], ['PhD', 'PhD / Doctorate']], lv) + '</div>'
      + '<div><label>Field (exact)</label>' + sel('gfField', [['', 'From their profile']].concat(FIELDS.map(f => [f, f])), '') + '</div>'
      + '<div><label>Their field, in words</label><input id="gfWords" value="' + esc([P.g_field, P.g_field2].filter(Boolean).join(', ')) + '" placeholder="Data Science, AI"></div>'
      + '<div><label>Intake</label>' + sel('gfIntake', [['', 'Any intake']].concat(terms().map((t, i) => [t, (i === 0 ? 'This semester — ' : i === 1 ? 'Next semester — ' : '') + t])), intake) + '</div>'
      + '<div><label>Public or private</label>' + sel('gfKind', [['any', 'Both'], ['public', 'Public'], ['private', 'Private']], 'any') + '</div>'
      + '<div><label>Budget (total)</label>' + sel('gfBudget', [['', 'From their profile'], ['0', 'No ceiling'], ['1000000', 'Under ₹10L'], ['2000000', 'Under ₹20L'], ['4000000', 'Under ₹40L']], '') + '</div>'
      + '<div><label>Name contains</label><input id="gfQ" placeholder="TUM, Data, Berlin"></div>'
      /* 10 Oct: the tag search — type, pick from the dictionary (/api/tags),
         and every chip has to hold on a row (server/matches.js screen, opts.tags). */
      + '<div class="gf-tags"><label>Tags (all of these)</label><input id="gfTagQ" placeholder="No German Required, MOI Accepted, TU Munich, Data Science…" autocomplete="off" aria-autocomplete="list" aria-expanded="false">'
      + '<div class="gf-sug" id="gfTagSug" role="listbox" hidden></div><div class="gf-chips" id="gfTagChips"></div></div>'
      + '<div><label>Specialisation</label><input id="gfSpec" placeholder="Embedded Systems"></div>'
      + '<div><label>Tuition per semester</label>' + sel('gfTuition', [['', 'Any tuition'], ['0', 'No tuition fee'], ['500', 'Up to €500'], ['1500', 'Up to €1,500'], ['4000', 'Up to €4,000'], ['6000', 'Up to €6,000']], '') + '</div>'
      + '<div><label>CGPA · out of · pass</label><div class="gf-row"><input id="gfCgpa" value="' + esc(P.d_cgpa || '') + '" inputmode="decimal"><input id="gfMax" value="' + esc(P.d_max || '10') + '" inputmode="decimal"><input id="gfPass" value="' + esc(P.d_pass || '') + '" inputmode="decimal" placeholder="pass"></div></div>'
      + '<div><label>Their bachelor’s</label><input id="gfBach" value="' + esc(P.d_course || '') + '" placeholder="B.Tech CSE"></div>'
      + '<div><label>German grade (1.0 best)</label><input id="gfGgpa" inputmode="decimal" placeholder="worked out from CGPA"></div>'
      + '<div><label>Bachelor’s length</label>' + sel('gfDur', [['', 'Not said'], ['3 years', '3 years'], ['4 years', '4 years'], ['5 years', '5 years']], (/(\d)/.exec(P.d_dur || '') || [])[1] ? (/(\d)/.exec(P.d_dur)[1] + ' years') : '') + '</div>'
      + '<div><label>English test · score</label><div class="gf-row">' + sel('gfEng', [['', 'Not said'], ['IELTS', 'IELTS'], ['TOEFL', 'TOEFL'], ['Medium of Instruction letter', 'MOI letter'], ['Not taken yet', 'Not taken']], eng) + '<input id="gfEngS" value="' + esc(P.e_score || '') + '" inputmode="decimal"></div></div>'
      + '<div><label>MOI letter (English-medium bachelor’s)</label>' + sel('gfMoi', [['', 'Not said'], ['yes', 'Yes — they have one'], ['no', 'No']], moi) + '</div>'
      + '<div><label>GRE · score</label><div class="gf-row">' + sel('gfGre', [['', 'Not said'], ['GRE', 'Taken'], ['Not taken yet', 'Not taken']], gre) + '<input id="gfGreS" value="' + esc(gre === 'GRE' ? (P.a_score || '') : '') + '" inputmode="numeric" placeholder="e.g. 315"></div></div>'
      /* Patch 153 — the home page's "More filters" controls, so the counsellor
       * can test exactly what a student would see. The GRE section row only
       * appears once a GRE score is typed (a section score without a total is
       * a question the server would not ask). */
      + '<div id="gfGreSecWrap"' + (gre === 'GRE' && P.a_score ? '' : ' hidden') + '><label>GRE quant · verbal · AWA</label><div class="gf-row">'
      + '<input id="gfGreQ" value="' + esc(P.a_quant || '') + '" inputmode="numeric" placeholder="Q">'
      + '<input id="gfGreV" value="' + esc(P.a_verbal || '') + '" inputmode="numeric" placeholder="V">'
      + '<input id="gfGreA" value="' + esc(P.a_awa || '') + '" inputmode="decimal" placeholder="AWA"></div></div>'
      + '<div><label>Bachelor’s ECTS</label>' + sel('gfEcts', [['', 'Not said'], ['180', '180 (3-year)'], ['210', '210'], ['240', '240 (4-year)']], P.d_ects || '') + '</div>'
      + '<div><label>Class rank</label>' + sel('gfTop', [['', 'Not said'], ['5', 'Top 5%'], ['10', 'Top 10%'], ['20', 'Top 20%'], ['30', 'Top 30%'], ['50', 'Top 50%'], ['100', 'Below 50%']], P.d_top || '') + '</div>'
      + '<div><label>Restricted admission</label>' + sel('gfRestricted', [['', 'Show all'], ['open', 'Only open admission'], ['restricted', 'Only restricted']], /^no$/i.test(P.g_restricted || '') ? 'open' : '') + '</div>'
      + '<div><label>Application fee</label>' + sel('gfFee', [['', 'Any application'], ['free', 'Free to apply'], ['package', 'Comes with a package']], '') + '</div>'
      + '<div><label>German level</label>' + sel('gfGer', [['', 'Not said'], ['None yet', 'None'], ['A1', 'A1'], ['A2', 'A2'], ['B1', 'B1'], ['B2', 'B2'], ['C1', 'C1'], ['C2', 'C2']], P.g_german || '') + '</div>'
      + '<div><label>Published a paper</label>' + sel('gfPapers', [['', 'Not said'], ['Yes', 'Yes'], ['No', 'No']], /^yes/i.test(P.g_papers || '') ? 'Yes' : /^no/i.test(P.g_papers || '') ? 'No' : '') + '</div>'
      + '<div><label>Work experience (months)</label><input id="gfWork" value="' + esc(/^no$/i.test(P.w_has || '') ? '0' : (P.w_months || '')) + '" inputmode="numeric" placeholder="not said"></div>'
      + '</div>'
      + '<p style="margin:10px 0 0"><button type="button" class="btn btn-primary btn-sm" id="gfGo">Find what fits</button>'
      + ' <span style="font-size:11.8px;color:var(--muted,#5d6b7a)">Nothing here is saved to the student’s file.</span></p>'
      + '<div id="gfOut"></div></div>';

    /* Round 175 (item 6d): every box has a label bound to it — a screen
       reader read 28 unnamed fields. A row's heading ("CGPA · out of ·
       pass") names its first box; the others get their own label from the
       same heading, off-screen. */
    el.querySelectorAll('.gf-grid > div').forEach(box => {
      const lab = box.querySelector(':scope > label'); const ctrls = box.querySelectorAll('input, select');
      if (!lab || !ctrls.length) return;
      const parts = lab.textContent.split('·').map(s => s.trim());
      ctrls.forEach((c, i) => {
        if (!c.id) return;
        if (i === 0) { lab.htmlFor = c.id; return; }
        const own = document.createElement('label');
        own.className = 'gf-sr'; own.htmlFor = c.id;
        own.textContent = parts.length === ctrls.length ? parts[0].split(' ')[0] + ' ' + parts[i] : lab.textContent + ' ' + (c.placeholder || String(i + 1));
        c.parentNode.insertBefore(own, c);
      });
    });

    /* Grow the destination list to the whole catalogue, keeping the choice. */
    if (!countriesLoaded) loadCountries().then(list => {
      const c = el.querySelector('#gfCountry'); if (!c) return;
      const keep = c.value;
      c.innerHTML = [['', 'Any country']].concat(list.map(x => [x, x]))
        .map(([val, t]) => '<option value="' + esc(val) + '"' + (val === keep ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
      if (!list.includes(keep)) c.value = countryPick(P.g_country);
    });

    const v = id => (el.querySelector('#' + id) || {}).value || '';
    /* The tag chips, and the suggestions box that fills them. */
    const TAGS_CHOSEN = [];
    const drawChips = () => {
      const c = el.querySelector('#gfTagChips'); if (!c) return;
      c.innerHTML = TAGS_CHOSEN.map((t, i) => '<button type="button" class="gf-chip" data-gftag="' + i + '" title="Remove">' + esc(t.value)
        + (t.type ? ' <small>' + esc(t.type) + '</small>' : '') + ' <b aria-hidden="true">×</b></button>').join('');
    };
    const hideSug = () => { const s = el.querySelector('#gfTagSug'); if (s) { s.hidden = true; s.innerHTML = ''; } const q = el.querySelector('#gfTagQ'); if (q) q.setAttribute('aria-expanded', 'false'); };
    const addTag = (value, type) => {
      const t = String(value || '').trim(); if (!t) return;
      if (!TAGS_CHOSEN.some(x => x.value.toLowerCase() === t.toLowerCase())) TAGS_CHOSEN.push({ value: t, type: type || '' });
      drawChips(); hideSug();
      const q = el.querySelector('#gfTagQ'); if (q) { q.value = ''; q.focus(); }
      go();
    };
    let sugTimer = null;
    const askSug = async () => {
      const q = el.querySelector('#gfTagQ'), s = el.querySelector('#gfTagSug'); if (!q || !s) return;
      const term = q.value.trim();
      if (term.length < 2) { hideSug(); return; }
      let list = [];
      try { const r = await fetch('/api/tags?q=' + encodeURIComponent(term) + '&limit=18', { credentials: 'same-origin' }); list = r.ok ? ((await r.json()).suggestions || []) : []; } catch (e) { list = []; }
      if (q.value.trim() !== term) return;
      if (!list.length) { hideSug(); return; }
      const by = new Map();
      list.forEach(x => { if (!by.has(x.type)) by.set(x.type, []); by.get(x.type).push(x); });
      let h = '';
      by.forEach((items, type) => { h += '<h6>' + esc(type) + '</h6>' + items.map(x => '<button type="button" role="option" aria-selected="false" data-gfsug="' + esc(x.value) + '" data-gfsugtype="' + esc(x.type) + '">' + esc(x.value) + (x.count > 1 ? '<em>' + x.count + ' programmes</em>' : '') + '</button>').join(''); });
      s.innerHTML = h; s.hidden = false; q.setAttribute('aria-expanded', 'true');
    };
    const moveSug = dir => {
      const items = [...el.querySelectorAll('#gfTagSug button')]; if (!items.length) return;
      let i = items.findIndex(b => b.getAttribute('aria-selected') === 'true');
      items.forEach(b => b.setAttribute('aria-selected', 'false'));
      i = i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
      items[i].setAttribute('aria-selected', 'true');
      if (items[i].scrollIntoView) items[i].scrollIntoView({ block: 'nearest' });
    };
    const filters = () => {
      const f = {
        g_country: v('gfCountry'), g_level: v('gfLevel'), g_field: v('gfWords'), g_field2: '',
        g_intake: v('gfIntake'), field: v('gfField'), kind: v('gfKind'), q: v('gfQ'),
        d_cgpa: v('gfCgpa'), d_max: v('gfMax'), d_pass: v('gfPass'), d_course: v('gfBach'), d_dur: v('gfDur'),
        e_test: v('gfEng'), e_score: /medium of instruction|not taken/i.test(v('gfEng')) ? '' : v('gfEngS'), g_german: v('gfGer'),
        d_moi: v('gfMoi'),
        a_test: v('gfGre'), a_score: v('gfGre') === 'GRE' ? v('gfGreS') : '',
      };
      if (v('gfBudget') !== '') f.ceiling = v('gfBudget');
      if (v('gfSpec').trim()) f.spec = v('gfSpec').trim();
      if (v('gfTuition') !== '') f.tuitionMax = v('gfTuition');
      if (v('gfGgpa').trim()) f.ggpa = v('gfGgpa').trim().replace(',', '.');
      f.g_papers = v('gfPapers');
      const wk = v('gfWork');
      if (wk !== '') { f.w_has = Number(wk) > 0 ? 'Yes' : 'No'; f.w_months = wk; }
      /* Patch 153 — the section scores travel only with a GRE total, the way
       * the home page sends them; the rest are the student's profile keys the
       * matcher reads (answersOf) plus the two screen-side filters. "Only open
       * admission" is both: the server drops restricted rows (restricted='no')
       * and the student is marked as not accepting them (g_restricted='no'). */
      const gre = v('gfGre') === 'GRE';
      f.a_quant = gre ? v('gfGreQ').trim() : '';
      f.a_verbal = gre ? v('gfGreV').trim() : '';
      f.a_awa = gre ? v('gfGreA').trim().replace(',', '.') : '';
      f.d_ects = v('gfEcts');
      f.d_top = v('gfTop');
      const rs = v('gfRestricted');
      f.g_restricted = rs === 'open' ? 'no' : '';
      f.restricted = rs === 'open' ? 'no' : rs === 'restricted' ? 'yes' : '';
      f.feeModel = v('gfFee');
      if (TAGS_CHOSEN.length) f.tags = TAGS_CHOSEN.map(t => t.value).join(';');
      /* Round 166: every fit — the biggest field has 900-odd rows; the server
         caps staff at 2,000. */
      f.limit = 2000;
      return f;
    };
    /* The GRE section row has nothing to say until there is a GRE score. */
    const greSections = () => {
      const w = el.querySelector('#gfGreSecWrap');
      if (w) w.hidden = v('gfGre') !== 'GRE';   /* patch 156: open on "Taken" */
    };
    el.addEventListener('input', e => { if (e.target.closest('#gfGre, #gfGreS')) greSections(); });
    el.addEventListener('change', e => { if (e.target.closest('#gfGre, #gfGreS')) greSections(); });

    /* Patch 153 (K) — one muted line of the special conditions a counsellor
     * must know about before promising a place: "Restrictions: No" when the
     * row is clear-cut, otherwise the conditions in plain words. Built from
     * what the server says about this row — the restricted flag, the notes
     * from check() and the unknowns it would ask the student. */
    const restrictions = r => {
      const out = [];
      if (r.restricted) out.push('restricted admission (ranked, limited places)');
      (r.notes || []).forEach(n => {
        if (/clears via moi/i.test(n)) out.push('English accepted via MOI letter');
        else if (!/restricted/i.test(n)) out.push(String(n));
      });
      const reqs = r.reqs || {};
      (r.ask || []).forEach(a => {
        if (/gre section/i.test(a)) out.push('GRE section scores needed');
        else if (/class rank/i.test(a) && reqs.topPercent) out.push('class rank top ' + reqs.topPercent + '% required');
        else out.push('tell us your ' + a + ' to confirm');
      });
      return out.length ? out.join(', ') : 'No';
    };
    const feeOf = r => (r.feeModel || (r.isPublic ? 'package' : 'free')) === 'free' ? 'Free to apply' : 'With a package';
    /* F9 (8 Oct): the home page's rule for a ₹0 total — a public programme
       has no tuition fee; a private one at ₹0 is a fee nobody has written down. */
    const cost = r => Number(r.totalInr) ? lakh(r.totalInr)
      : (r.isPublic || (r.reqs && r.reqs.tuitionEurSem === 0) ? 'No tuition fee' : 'Fee to be confirmed');
    /* Round 165: the rank, per university — the first programme of the first
       university is #1, a second programme at the same university shares its
       number, the next university is #2. With the kind filter on the package's
       kind, the student's #1 is this #1: the same one-per-university order
       the package delivers. */
    /* Round 177 (item 8): a near row says its reason FIRST — "Near — short
       of something they ask: English test: asks IELTS 7, they have IELTS 5"
       — before the programme line; a row short of a stated requirement is
       never under "Fits". */
    const item = (r, onList, canAdd, rk) => '<li>' + (rk ? '<span class="rk" title="Rank for this profile">#' + rk + '</span> ' : '')
      + '<div class="m"><b>' + logoTile(r) + '<span>' + esc(r.university)
      + (r.restricted ? ' <span class="tag">Restricted</span>' : '') + '</span></b>'
      + (r.why && r.why.length ? '<small class="why">' + (r.hard && r.hard.length ? 'Near — short of something they ask: ' : '') + esc(r.why.join('; ')) + '</small>' : '')
      + '<small>' + esc(r.program) + ' · ' + (r.isPublic ? 'Public' : 'Private') + ' · ' + feeOf(r) + ' · ' + esc(r.city || '') + ' · ' + cost(r)
      + (nextDeadline(r.intakes, v('gfIntake')) ? ' · closes ' + nextDeadline(r.intakes, v('gfIntake')) : '') + '</small>'
      /* Round 175: every published deadline has passed — said before the
         Add button asks "Add anyway?", and the row ranks after open ones. */
      + (r.closed ? '<small class="soft">Every deadline has passed' + (r.lastDeadline ? ' (last ' + esc(dateSaid(r.lastDeadline)) + ')' : '') + ' — next intake not announced</small>' : '')
      /* Patch 162: short of something stated — on the list, ranked lower, the
         counsellor's call. */
      + (r.soft && r.soft.length ? '<small class="soft">Lower priority — ' + esc(r.soft.join('; ')) + '</small>' : '')
      + (r.ask && r.ask.length ? '<small class="ask">Not known yet: ' + esc(r.ask.join(', ')) + '</small>' : '')
      + (r.notes && r.notes.length ? '<small>' + esc(r.notes.join(' · ')) + '</small>' : '')
      + '<small>Restrictions: ' + esc(restrictions(r)) + '</small>'
      + (r.tags && r.tags.length ? '<small>' + r.tags.map(t => '<span class="tagpill">' + esc(t) + '</span>').join('') + '</small>' : '')
      + '</div>' + (onList.has(String(r.id)) ? '<span class="tag">on their list</span>'
        : canAdd ? '<button type="button" class="btn btn-ghost btn-sm" data-gfadd="' + esc(r.id) + '">Add</button>' : '')
      + '</li>';

    /* Round 176: every run is numbered, and only the LATEST may write the
       panel. The page mounts with autorun — a slow first run over the whole
       catalogue — and a counsellor who then typed CGPA 15 and pressed Find
       saw "cannot be more than its scale" under the box and, a second later,
       the first run's "417 fit" land in the summary over it (round175rulestest
       caught it). A stale answer is dropped, whether it is results or an
       error. */
    let runSeq = 0;
    async function go() {
      const out = el.querySelector('#gfOut');
      const mine = ++runSeq;
      out.innerHTML = '<p class="sum">Checking every programme against the same rules the paid shortlist uses…</p>';
      let d;
      /* Round 175 (item 6a): the server refuses a score that cannot exist
         (422 with fields:[{field, why}]) — the word goes under the box it
         is about, and the box is marked, as well as the line in #gfOut. */
      const FIELD_BOX = { d_cgpa: 'gfCgpa', d_max: 'gfMax', d_pass: 'gfPass', e_score: 'gfEngS', a_score: 'gfGreS',
        a_quant: 'gfGreQ', a_verbal: 'gfGreV', a_awa: 'gfGreA', ggpa: 'gfGgpa', w_months: 'gfWork', g_country: 'gfCountry' };
      el.querySelectorAll('.gf-err').forEach(x => x.remove());
      el.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
      try { d = await o.run(filters()); } catch (e) {
        if (mine !== runSeq) return;
        out.innerHTML = '<p class="why">' + esc(e.message || 'Could not run that.') + '</p>';
        (Array.isArray(e.fields) ? e.fields : []).forEach(f => {
          const box = el.querySelector('#' + (FIELD_BOX[f.field] || '')); if (!box) return;
          box.setAttribute('aria-invalid', 'true');
          const row = box.closest('.gf-row') || box;
          const m = document.createElement('small'); m.className = 'gf-err'; m.id = box.id + 'Err'; m.textContent = f.why;
          box.setAttribute('aria-describedby', m.id);
          row.parentNode.insertBefore(m, row.nextSibling);
        });
        return;
      }
      if (mine !== runSeq) return;
      /* Round 175: the server declines to judge an empty profile — no level,
         no field, no CGPA — rather than count the whole catalogue as a fit. */
      if (Array.isArray(d.needs) && d.needs.length) {
        out.innerHTML = '<p class="why" id="gfNeeds">Tell us more first — set at least the ' + esc(d.needs.join(' and ')) + '.</p>';
        return;
      }
      const onList = new Set((d.onList || []).map(String));
      const canAdd = typeof o.onAdd === 'function';
      const auto = (d.auto || []).map(a => '<div><b>' + esc(a.package || a.kind) + '</b> — '
        + (a.picks.length ? a.picks.length + ' of ' + a.count + ': ' + a.picks.map(p => esc(p.university)).join(', ') : 'nothing fits yet')
        + (a.note ? '<small>' + esc(a.note) + '</small>' : '') + '</div>').join('');
      /* F9 (8 Oct): a count of what "fits" means nothing until the student's
         CGPA, level and field are known — say what is missing instead. */
      /* CNS-02 (12 Oct): judged on what is in the FORM — the values this
         search ran with — not on the saved profile. A CGPA, level and field
         typed here (the Field dropdown counts) are enough; the warning names
         only what is still missing. */
      const fv = filters();
      const has = x => String(x == null ? '' : x).trim() !== '';
      const missing = [has(fv.d_cgpa) ? '' : 'CGPA', has(fv.g_level) ? '' : 'level',
        has(fv.g_field) || has(fv.field) ? '' : 'field'].filter(Boolean);
      const basics = !missing.length;
      /* Round 166: the whole set draws — the counsellor's rule is that she
         sees ALL of it in rank order (round 165 checks the row count), and
         the biggest field is 900-odd rows. Logos load lazily and the rows
         carry content-visibility:auto, so the browser lays out only what is
         on screen; 900 rows cost about what 60 did. */
      const draw = () => { out.innerHTML = (basics
          ? '<p class="sum">' + d.counts.looked + ' programmes in that field and level · <b>' + d.counts.fits + ' fit</b> · '
            + d.counts.near + ' near' + (d.counts.unknownDates ? ' · ' + d.counts.unknownDates + ' publish no dates' : '') + '</p>'
          : '<p class="why">Add the student\'s ' + missing.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' to judge fit.</p>')
        + (auto ? '<div class="auto"><b style="display:block;margin-bottom:4px">What a package would deliver now'
          + (d.bought === false ? ' (not bought yet)' : '') + '</b>' + auto + '</div>' : '')
        + '<h4>Fits (' + d.fits.length + (d.counts.fits > d.fits.length ? ' of ' + d.counts.fits : '') + ')</h4>'
        + (d.fits.length ? '<ul>' + (() => { const seen = new Map(); return d.fits.map(r => {
            const k = String(r.university || r.id).toLowerCase();
            if (!seen.has(k)) seen.set(k, seen.size + 1);
            return item(r, onList, canAdd, seen.get(k)); }).join(''); })() + '</ul>' : '<p class="sum">Nothing fits every answer.</p>')
        + '<h4>Near — short of something they ask (' + d.near.length + ')</h4>'
        + (d.near.length ? '<ul>' + d.near.map(r => item(r, onList, canAdd)).join('') + '</ul>' : '<p class="sum">None.</p>'); };
      draw();
      /* The logos, once the index is here — the first run draws without
         them and redraws; after that it is already loaded. */
      if (!logoIdx) loadLogos().then(L => { if (L && out.isConnected && mine === runSeq) draw(); });
    }
    el.addEventListener('click', async e => {
      if (e.target.closest('#gfGo')) { go(); return; }
      const sug = e.target.closest('[data-gfsug]');
      if (sug) { e.preventDefault(); addTag(sug.dataset.gfsug, sug.dataset.gfsugtype); return; }
      const chip = e.target.closest('[data-gftag]');
      if (chip) { e.preventDefault(); TAGS_CHOSEN.splice(Number(chip.dataset.gftag), 1); drawChips(); go(); return; }
      if (!e.target.closest('.gf-tags')) hideSug();
      const add = e.target.closest('[data-gfadd]');
      if (add && o.onAdd) {
        add.disabled = true;
        try { await o.onAdd(add.dataset.gfadd); add.outerHTML = '<span class="tag">on their list</span>'; }
        catch (err) {
          /* Round 175: every deadline has passed (409, closed). Ask, and on
             yes send it again with force — the student is then told the
             next intake is not announced yet. */
          if (err && err.closed) {
            const sure = typeof o.confirm === 'function' ? await o.confirm(err.message) : window.confirm(err.message || 'Every deadline for this programme has passed. Add anyway?');
            if (sure) {
              try { await o.onAdd(add.dataset.gfadd, { force: true }); add.outerHTML = '<span class="tag">on their list</span>'; return; }
              catch (e2) { add.disabled = false; add.insertAdjacentHTML('afterend', '<small class="why">' + esc(e2.message || 'Could not add it.') + '</small>'); return; }
            }
            add.disabled = false; return;
          }
          add.disabled = false; add.insertAdjacentHTML('afterend', '<small class="why">' + esc(err.message || 'Could not add it.') + '</small>');
        }
      }
    });
    el.addEventListener('input', e => { if (e.target.id === 'gfTagQ') { clearTimeout(sugTimer); sugTimer = setTimeout(askSug, 160); } });
    el.addEventListener('keydown', e => {
      if (e.target.id === 'gfTagQ') {
        const s = el.querySelector('#gfTagSug');
        if (e.key === 'Escape') { if (s && !s.hidden) { e.preventDefault(); e.stopPropagation(); hideSug(); } return; }
        if (s && !s.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); moveSug(e.key === 'ArrowDown' ? 1 : -1); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          const hi = s && !s.hidden ? (s.querySelector('button[aria-selected="true"]') || s.querySelector('button')) : null;
          if (hi) addTag(hi.dataset.gfsug, hi.dataset.gfsugtype);
          else if (e.target.value.trim()) addTag(e.target.value.trim(), '');
          return;
        }
      }
      if (e.key === 'Enter' && e.target.closest('input')) { e.preventDefault(); go(); }
    });
    if (o.autorun) go();
  }
  window.GlovelsFit = { mount };
})();
